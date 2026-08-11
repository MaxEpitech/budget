// Tests des secrets envoyés au navigateur ou par email (jetons, sessions).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fabriquerSecret, empreinte, DUREES } from "../src/auth/secrets.js";

test("un secret est utilisable tel quel dans une URL", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(fabriquerSecret(), /^[A-Za-z0-9_-]+$/, "caractère à échapper dans un lien");
  }
});

test("un secret porte 256 bits d'entropie", () => {
  // 32 octets en base64url → 43 caractères.
  assert.equal(Buffer.from(fabriquerSecret(), "base64url").length, 32);
  assert.equal(fabriquerSecret().length, 43);
});

test("deux secrets ne se répètent pas", () => {
  const vus = new Set();
  for (let i = 0; i < 5000; i++) vus.add(fabriquerSecret());
  assert.equal(vus.size, 5000);
});

test("l'empreinte est déterministe et ne laisse pas transparaître le secret", () => {
  const secret = fabriquerSecret();
  assert.equal(empreinte(secret), empreinte(secret));
  assert.notEqual(empreinte(secret), secret);
  assert.ok(!empreinte(secret).includes(secret.slice(0, 8)));
  assert.match(empreinte(secret), /^[0-9a-f]{64}$/);
});

test("deux secrets voisins donnent des empreintes sans rapport", () => {
  assert.notEqual(empreinte("jetonA"), empreinte("jetonB"));
});

test("les durées de vie sont celles annoncées", () => {
  assert.equal(DUREES.validation, 24 * 60 * 60 * 1000, "validation : 24 h");
  assert.equal(DUREES.reinitialisation, 60 * 60 * 1000, "réinitialisation : 1 h");
  assert.equal(DUREES.session, 30 * 24 * 60 * 60 * 1000, "session : 30 jours");
  assert.ok(DUREES.reinitialisation < DUREES.validation, "la réinitialisation doit être la plus courte");
});
