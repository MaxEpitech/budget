// Chiffrement des secrets confiés par les foyers — tests unitaires.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { chiffrer, dechiffrer, chiffrementDisponible } from "../src/banque/chiffrement.js";

beforeEach(() => {
  process.env.CLE_CHIFFREMENT = "une phrase de chiffrement pour les essais seulement";
});

test("un secret chiffré se relit à l'identique", () => {
  for (const secret of ["cle-secrete", "avec des accents éàü et des symboles ₿🔑", "x".repeat(300)]) {
    assert.equal(dechiffrer(chiffrer(secret)), secret);
  }
});

test("le texte chiffré ne laisse rien voir du secret", () => {
  const chiffre = chiffrer("cle-secrete-du-foyer");
  assert.ok(chiffre.startsWith("v1."));
  assert.ok(!chiffre.includes("cle-secrete"));
});

test("chiffrer deux fois le même secret ne donne pas deux fois le même texte", () => {
  // Sinon deux foyers partageant une clé se reconnaîtraient à la lecture de la base.
  assert.notEqual(chiffrer("identique"), chiffrer("identique"));
});

test("une valeur altérée est rejetée plutôt que relue de travers", () => {
  const [version, iv, sceau, corps] = chiffrer("cle-secrete").split(".");
  const retourne = corps[0] === "A" ? "B" : "A";
  assert.equal(dechiffrer([version, iv, sceau, retourne + corps.slice(1)].join(".")), null);
  assert.equal(dechiffrer([version, iv, sceau].join(".")), null);
  assert.equal(dechiffrer(["v0", iv, sceau, corps].join(".")), null, "format inconnu");
  for (const v of [null, undefined, "", "n'importe quoi"]) assert.equal(dechiffrer(v), null);
});

test("avec une autre clé, le secret est illisible", () => {
  const chiffre = chiffrer("cle-secrete");
  process.env.CLE_CHIFFREMENT = "une tout autre phrase de chiffrement, changée depuis";
  assert.equal(dechiffrer(chiffre), null);
});

test("une clé absente ou trop courte désactive le chiffrement", () => {
  for (const v of [undefined, "", "trop court", " ".repeat(40)]) {
    if (v === undefined) delete process.env.CLE_CHIFFREMENT;
    else process.env.CLE_CHIFFREMENT = v;
    assert.equal(chiffrementDisponible(), false);
    assert.throws(() => chiffrer("secret"));
    assert.equal(dechiffrer("v1.a.b.c"), null);
  }
});
