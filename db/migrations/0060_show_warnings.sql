-- Whether a person sees projects' and maintenance records' warnings on screen (the red cards, "Late",
-- the "Needs attention" banners): their own switch on the Projects and Maintenance pages, kept with
-- their account so it follows them to every device (lib/client/warnings.tsx). Off unless turned on.
--
-- Re-runnable.
ALTER TABLE users ADD COLUMN IF NOT EXISTS show_warnings boolean DEFAULT false NOT NULL;
