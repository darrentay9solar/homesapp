-- Geofencing for site check-in and check-out.
--
-- Enforced in the database, not in the request handler, because a client
-- controls the coordinates it sends and a handler can be bypassed. The
-- application performs the same check first so the crew gets a civil message;
-- this is what makes it true.

-- Great-circle distance in metres. IMMUTABLE so it can be used in constraints
-- and indexes later, and self-contained so no PostGIS extension is needed for
-- what is one formula.
CREATE OR REPLACE FUNCTION geo_distance_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 6371000 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;
--> statement-breakpoint

-- A fix this imprecise cannot be judged against a 100 m radius either way.
CREATE OR REPLACE FUNCTION geo_max_accuracy_m() RETURNS double precision
LANGUAGE sql IMMUTABLE AS $$ SELECT 50.0::double precision $$;
--> statement-breakpoint

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
  -- Shown to the crew. Deliberately the same wording whether the fix is weak
  -- or they are simply somewhere else: the remedy is identical, and a message
  -- that says "you are 800 m away" invites arguing with it.
  c_message  text := 'You''re currently not receiving GPS signal, please move to a spot where you can.';
BEGIN
  SELECT p.site_lat, p.site_lng, p.check_in_radius_m, p.postal_code
    INTO v_lat, v_lng, v_radius, v_postal
    FROM projects p WHERE p.project_id = NEW.project_id;

  -- Decide which half of the visit is being verified.
  IF TG_OP = 'INSERT' THEN
    v_phase := 'check-in';
    v_use_lat := NEW.lat; v_use_lng := NEW.lng; v_acc := NEW.accuracy_m;
  ELSIF NEW.checked_out_at IS NOT NULL AND OLD.checked_out_at IS NULL THEN
    v_phase := 'check-out';
    v_use_lat := NEW.checkout_lat; v_use_lng := NEW.checkout_lng; v_acc := NEW.checkout_accuracy_m;
  ELSE
    RETURN NEW; -- an unrelated update, e.g. correcting a crew count
  END IF;

  -- Refuse rather than wave through: an unverifiable check-in recorded as
  -- verified is worse than no check-in at all.
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
            -- The truth is kept here, for the project manager and the logs,
            -- without telling the crew how far off they need to be.
            DETAIL = format('%s was %s m from the site (limit %s m, postal %s)',
                            v_phase, round(v_dist::numeric, 1), v_radius,
                            COALESCE(v_postal, 'unknown'));
  END IF;

  -- Record the measured distance so it cannot be recomputed later against
  -- corrected coordinates.
  IF TG_OP = 'INSERT' THEN
    NEW.distance_m := v_dist;
  ELSE
    NEW.checkout_distance_m := v_dist;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER enforce_check_in_radius_insert
  BEFORE INSERT ON site_check_ins
  FOR EACH ROW EXECUTE FUNCTION enforce_check_in_radius();
--> statement-breakpoint

CREATE TRIGGER enforce_check_in_radius_update
  BEFORE UPDATE ON site_check_ins
  FOR EACH ROW EXECUTE FUNCTION enforce_check_in_radius();
