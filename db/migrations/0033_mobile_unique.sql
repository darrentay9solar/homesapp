-- One mobile number, one account.
--
--  * users_contact_no_digits_idx: no two accounts may hold the same mobile
--    number. Compared by its digits, so "+65 9123 4567", "+6591234567" and
--    "+65 9123-4567" are the same number. Deactivated accounts count too, so
--    reactivating one can never collide with an account made since.
--    The forms check first and say which field is wrong; this is the rule
--    that holds whatever sends the row (an import, a seed, two people at once).
--
-- Re-runnable. Stops with a message if accounts already share a number.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "contact_no" IS NOT NULL
              GROUP BY regexp_replace("contact_no", '[^0-9]', '', 'g') HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Two or more accounts share a mobile number. Give each its own (or clear it) before running this migration.';
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "users_contact_no_digits_idx" ON "users" USING btree (regexp_replace("contact_no", '[^0-9]', '', 'g')) WHERE "contact_no" IS NOT NULL;
