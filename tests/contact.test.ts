/**
 * How to reach 9 Solar Home: `npm run test:web`.
 *
 *   links     calling and WhatsApp go to the Singapore numbers given
 *   Chinese   every label on the contact page has its translation
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import zh from "../api/_lib/i18n/zh.json";
import { CONTACT, sgNumber, telHref, whatsappHref } from "../lib/client/contact";

describe("calling and WhatsApp", () => {
  it("new clients", () => {
    assert.equal(sgNumber(CONTACT.newClients), "+6589899568");
    assert.equal(telHref(CONTACT.newClients), "tel:+6589899568");
    assert.equal(whatsappHref(CONTACT.newClients), "https://wa.me/6589899568");
  });
  it("after sales", () => {
    assert.equal(telHref(CONTACT.postSales), "tel:+6588996734");
    assert.equal(whatsappHref(CONTACT.postSales), "https://wa.me/6588996734");
  });
  it("the links go out over https", () => {
    for (const l of CONTACT.links) assert.match(l.href, /^https:\/\//);
  });
});

describe("the contact page in Chinese", () => {
  it("has every link's label", () => {
    const dict = zh as Record<string, string>;
    assert.deepEqual(CONTACT.links.map((l) => l.label).filter((l) => !(l in dict)), []);
  });
});
