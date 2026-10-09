-- Check-in and check-out refusals now say what's actually wrong:
--   no location from the phone   "We couldn't get your phone's location. ..."
--   a weak GPS fix (over 50 m)    "You're currently not receiving GPS signal, ..."
--   too far from the house        "You're not at the check-in location (about 1.2 km away). ..."
-- Before, all three read as the GPS-signal message, which sent a crew member
-- standing in the wrong street looking for a better signal. The rules
-- themselves are unchanged (0013). Re-runnable.

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
  v_away     text;
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
    RAISE EXCEPTION 'We couldn''t get your phone''s location. Allow location for GetHomeApps, then try again.'
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
    -- How far, as the app writes it: "140 m", "1.2 km", "12 km".
    v_away := CASE
      WHEN round(v_dist / 10) * 10 < 1000 THEN (round(v_dist / 10) * 10)::int || ' m'
      WHEN v_dist < 10000 THEN to_char(round((v_dist / 1000)::numeric, 1), 'FM990.0') || ' km'
      ELSE round(v_dist / 1000)::int || ' km'
    END;
    RAISE EXCEPTION '%', CASE v_phase
        WHEN 'check-in' THEN format('You''re not at the check-in location (about %s away). Please head to the site to check in.', v_away)
        ELSE format('You''re not at the site (about %s away). Please check out at the site.', v_away)
      END
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
