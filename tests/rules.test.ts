/**
 * The rules forms check before sending, as the sentence under the field: `npm run test:web`.
 *
 *   each      every rule says what's wrong, and nothing when it's right
 *   chinese   the sentences come in the person's language
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codeProblem, confirmProblem, emailProblem, firstProblem, icLast4Problem, mobileProblem, nameProblem, passwordProblem, postalProblem, requiredProblem, textProblem } from "../lib/client/rules";

describe("each rule", () => {
  it("email", () => {
    assert.equal(emailProblem("  "), "Enter your email.");
    assert.match(emailProblem("jo@") ?? "", /doesn't look right/);
    assert.equal(emailProblem(" jo@example.com "), null);
  });
  it("name", () => {
    assert.equal(nameProblem(""), "Enter your full name.");
    assert.equal(nameProblem("J"), "That name is too short.");
    assert.equal(nameProblem("Jo"), null);
  });
  it("mobile", () => {
    assert.match(mobileProblem("") ?? "", /Enter your mobile number/);
    assert.equal(mobileProblem("123 45"), "A mobile number has at least 6 digits.");
    assert.equal(mobileProblem("9123 4567"), null);
  });
  it("password: how many more characters, and the second copy", () => {
    assert.equal(passwordProblem(""), "Choose a password of at least 15 characters.");
    assert.equal(passwordProblem("short one"), "The password needs at least 15 characters: 6 more to go.");
    assert.equal(passwordProblem("a long enough phrase"), null);
    assert.equal(confirmProblem("abc", ""), "Type the password again.");
    assert.equal(confirmProblem("abc", "abd"), "The two passwords don't match.");
    assert.equal(confirmProblem("abc", "abc"), null);
  });
  it("code, postal code, NRIC last 4", () => {
    assert.equal(codeProblem("123"), "Enter all 6 digits of the code.");
    assert.equal(codeProblem("123456"), null);
    assert.equal(postalProblem(""), null);
    assert.equal(postalProblem("12345"), "A Singapore postal code is 6 digits.");
    assert.equal(postalProblem("569933"), null);
    assert.equal(icLast4Problem(""), null);
    assert.match(icLast4Problem("S123") ?? "", /three digits and a letter/);
    assert.equal(icLast4Problem("567d"), null);
  });
  it("free text and choices", () => {
    assert.equal(textProblem("", 10, "a reason"), "Enter a reason.");
    assert.equal(textProblem("too short", 10, "a reason"), "Write a little more: at least 10 characters (1 more).");
    assert.equal(textProblem("long enough now", 10, "a reason"), null);
    assert.equal(requiredProblem("", "a role"), "Choose a role.");
    assert.equal(firstProblem(null, undefined, "B", "C"), "B");
    assert.equal(firstProblem(null, null), null);
  });
});
