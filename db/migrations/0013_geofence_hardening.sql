-- Closes the gaps in the check-in geofence found on review.
--
-- 0007 verified the location at the moment of check-in and check-out, but
-- trusted everything else the client sent:
--
--   * the time. checked_in_at defaulted to now() but a client could send its
--     own, so a crew arriving at 10:30 could record 08:00.
--   * later edits. Any UPDATE that was not the check-out itself skipped the
--     checks, so lat/lng/distance could be rewritten after the fact, and a
--     completed check-out could be moved by changing checked_out_at again.
--   * a check-out on INSERT. A row inserted already checked out had its
--     check-out location never examined.
--
-- And separately, changing a project's postal code left the old coordinates
-- in place, so the fence stayed around the previous address.

CREATE OR REPLACE FUNCTION enforce_check_in_radius() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lat      double precision;
  v_lng      double precision;
  v_radius   integer;
  v_postal   varchar(6);
  v_dist     double precision;
  v_acc      double precision;
  v_phase    text;
  v_use_lat  double precision;
  v_use_lng  double precision;
  c_message  text := 'You''re currently not receiving GPS signal, please move to a spot where you can.';
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_phase := 'check-in';

    IF NEW.checked_out_at IS NOT NULL OR NEW.crew_out IS NOT NULL
       OR NEW.checkout_lat IS NOT NULL OR NEW.checkout_lng IS NOT NULL
       OR NEW.checkout_accuracy_m IS NOT NULL OR NEW.checkout_distance_m IS NOT NULL THEN
      RAISE EXCEPTION 'Check in first; check out is a separate step.'
        USING ERRCODE = 'P0001';
    END IF;

    IF NEW.crew_in IS NULL OR NEW.crew_in < 1 THEN
      RAISE EXCEPTION 'Enter how many crew are on site.' USING ERRCODE = 'P0001';
    END IF;

    -- The database's clock, never the phone's.
    NEW.checked_in_at := now();
    v_use_lat := NEW.lat; v_use_lng := NEW.lng; v_acc := NEW.accuracy_m;

  ELSE
    -- Where and when the crew arrived is history once recorded.
    IF (NEW.project_id, NEW.user_id, NEW.checked_in_at,
        NEW.lat, NEW.lng, NEW.accuracy_m, NEW.distance_m)
       IS DISTINCT FROM
       (OLD.project_id, OLD.user_id, OLD.checked_in_at,
        OLD.lat, OLD.lng, OLD.accuracy_m, OLD.distance_m)
    THEN
      RAISE EXCEPTION 'A check-in''s time and location cannot be changed.'
        USING ERRCODE = 'P0001';
    END IF;

    IF OLD.checked_out_at IS NOT NULL THEN
      -- Already checked out: the check-out is history too. Crew counts and
      -- the linked visit may still be corrected.
      IF (NEW.checked_out_at, NEW.checkout_lat, NEW.checkout_lng,
          NEW.checkout_accuracy_m, NEW.checkout_distance_m)
         IS DISTINCT FROM
         (OLD.checked_out_at, OLD.checkout_lat, OLD.checkout_lng,
          OLD.checkout_accuracy_m, OLD.checkout_distance_m)
      THEN
        RAISE EXCEPTION 'A check-out''s time and location cannot be changed.'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.checked_out_at IS NULL THEN
      -- Still on site. Check-out fields stay empty until the check-out.
      IF (NEW.checkout_lat, NEW.checkout_lng, NEW.checkout_accuracy_m, NEW.checkout_distance_m)
         IS DISTINCT FROM (NULL::float8, NULL::float8, NULL::float8, NULL::float8)
      THEN
        RAISE EXCEPTION 'Check-out location is recorded only when checking out.'
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END IF;

    v_phase := 'check-out';

    IF NEW.crew_out IS NULL OR NEW.crew_out < 0 THEN
      RAISE EXCEPTION 'Enter how many crew are leaving.' USING ERRCODE = 'P0001';
    END IF;

    NEW.checked_out_at := now();
    v_use_lat := NEW.checkout_lat; v_use_lng := NEW.checkout_lng; v_acc := NEW.checkout_accuracy_m;
  END IF;

  SELECT p.site_lat, p.site_lng, p.check_in_radius_m, p.postal_code
    INTO v_lat, v_lng, v_radius, v_postal
    FROM projects p WHERE p.project_id = NEW.project_id;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RAISE EXCEPTION 'This site has no verified location yet.'
      USING ERRCODE = 'P0001',
            DETAIL = format('project %s has no coordinates', NEW.project_id),
            HINT = 'Geocode the project address from its postal code before crews check in.';
  END IF;

  IF v_use_lat IS NULL OR v_use_lng IS NULL THEN
    RAISE EXCEPTION '%', c_message
      USING ERRCODE = 'P0002',
            DETAIL = format('%s submitted with no coordinates', v_phase);
  END IF;

  IF v_acc IS NULL OR v_acc > geo_max_accuracy_m() THEN
    RAISE EXCEPTION '%', c_message
      USING ERRCODE = 'P0002',
            DETAIL = format('%s fix accurate only to %s m (limit %s m)',
                            v_phase, COALESCE(round(v_acc::numeric, 1)::text, 'unknown'),
                            geo_max_accuracy_m());
  END IF;

  v_dist := geo_distance_m(v_lat, v_lng, v_use_lat, v_use_lng);

  IF v_dist > v_radius THEN
    RAISE EXCEPTION '%', c_message
      USING ERRCODE = 'P0002',
            DETAIL = format('%s was %s m from the site (limit %s m, postal %s)',
                            v_phase, round(v_dist::numeric, 1), v_radius,
                            COALESCE(v_postal, 'unknown'));
  END IF;

  -- Always computed here, whatever the client sent.
  IF TG_OP = 'INSERT' THEN
    NEW.distance_m := v_dist;
  ELSE
    NEW.checkout_distance_m := v_dist;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

-- One open check-in per person per site. Stops a double tap, or a crew lead
-- who forgot to check out yesterday, producing two overlapping visits.
CREATE UNIQUE INDEX IF NOT EXISTS site_check_ins_one_open_idx
  ON site_check_ins (project_id, user_id)
  WHERE checked_out_at IS NULL;
--> statement-breakpoint

-- A new postal code means a new place. Unless the same update supplies new
-- coordinates, the old ones are cleared — check-ins are then refused with
-- "no verified location" until the project is geocoded again, which is far
-- better than a fence silently drawn around the previous address.
CREATE OR REPLACE FUNCTION reset_site_location_on_postal_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.postal_code IS DISTINCT FROM OLD.postal_code
     AND NEW.site_lat IS NOT DISTINCT FROM OLD.site_lat
     AND NEW.site_lng IS NOT DISTINCT FROM OLD.site_lng
  THEN
    NEW.site_lat         := NULL;
    NEW.site_lng         := NULL;
    NEW.geocoded_address := NULL;
    NEW.geocode_source   := NULL;
    NEW.geocoded_at      := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER projects_reset_location_on_postal_change
  BEFORE UPDATE OF postal_code ON projects
  FOR EACH ROW EXECUTE FUNCTION reset_site_location_on_postal_change();
