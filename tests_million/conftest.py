"""The million-case suite (npm run test:million): pure rules, checked case by case.

Kept apart from tests_py so none of its per-test setup (sign-in keys, storage,
push) runs a million times: nothing here touches the database, the network or
files. api/ is on the path (pyproject.toml), so _lib imports as in the app.
"""

import os

# Nothing here may reach a database: no connection string at all.
for key in ("DATABASE_URL", "MIGRATION_DATABASE_URL", "PROD_DATABASE_URL", "PROD_MIGRATION_DATABASE_URL"):
    os.environ[key] = ""
