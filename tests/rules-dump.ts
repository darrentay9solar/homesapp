/**
 * Runs the screens' form rules (lib/client/rules.ts) on a list of values and
 * prints what each says, so tests_py/test_form_rules.py can check the server
 * accepts and refuses exactly the same ones. Not a test by itself.
 *
 *   tsx tests/rules-dump.ts cases.json   ->   [{ kind, value, problem }]
 */
import { readFileSync } from "node:fs";

import { emailProblem, icLast4Problem, mobileProblem, nameProblem, PASSWORD_MIN, passwordProblem, postalProblem } from "../lib/client/rules";

type Case = { kind: "mobile" | "email" | "ic" | "postal" | "name" | "password"; value: string };
const RULE: Record<Case["kind"], (v: string) => string | null> = {
  mobile: (v) => mobileProblem(v),
  email: (v) => emailProblem(v),
  ic: (v) => icLast4Problem(v),
  postal: (v) => postalProblem(v),
  name: (v) => nameProblem(v),
  password: (v) => passwordProblem(v),
};

const cases = JSON.parse(readFileSync(process.argv[2], "utf8")) as Case[];
process.stdout.write(JSON.stringify({ passwordMin: PASSWORD_MIN, results: cases.map((c) => ({ ...c, problem: RULE[c.kind](c.value) })) }));
