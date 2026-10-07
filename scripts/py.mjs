// Runs the project's Python (web/.venv) on Windows, macOS and Linux alike, so
// npm scripts don't depend on the shell: `node scripts/py.mjs -m pytest -q`.
import { spawnSync } from "node:child_process";
import path from "node:path";

const exe = process.platform === "win32" ? path.join(".venv", "Scripts", "python.exe") : path.join(".venv", "bin", "python");
const r = spawnSync(exe, process.argv.slice(2), { stdio: "inherit" });
if (r.error) console.error(`Couldn't run ${exe}: ${r.error.message}. Create the virtualenv first (see README).`);
process.exit(r.status ?? 1);
