// Expurgation des journaux.
//
// C'est par les journaux que les secrets fuitent le plus souvent : ils sont
// conservés longtemps, recopiés vers des outils tiers, et lus par plus de monde
// que la base elle-même. Ce filtre est donc la dernière barrière, et il doit
// tenir même sur des structures imbriquées.
import assert from "node:assert/strict";
import { test } from "node:test";
import { expurger } from "../src/journal.js";

test("les champs sensibles sont masqués, quel que soit leur nom", () => {
  const propre = expurger({
    email: "alex@exemple.fr",
    motDePasse: "phrase secrète",
    motdepasse: "phrase secrète",
    password: "secret",
    motDePasseHash: "scrypt$…",
    jeton: "abc",
    token: "abc",
    cookie: "session=abc",
    authorization: "Bearer abc",
  });

  assert.equal(propre.email, "alex@exemple.fr", "ce qui n'est pas sensible doit rester lisible");
  for (const cle of ["motDePasse", "motdepasse", "password", "motDePasseHash", "jeton", "token", "cookie", "authorization"]) {
    assert.equal(propre[cle], "[masqué]", `${cle} aurait dû être masqué`);
  }
});

test("le masquage descend dans les structures imbriquées", () => {
  const propre = expurger({
    requete: { corps: { motDePasse: "secret", email: "a@b.fr" } },
    sessions: [{ jetonHache: "abc" }, { jetonHache: "def" }],
  });
  assert.equal(propre.requete.corps.motDePasse, "[masqué]");
  assert.equal(propre.requete.corps.email, "a@b.fr");
  assert.equal(propre.sessions[0].jetonHache, "[masqué]");
  assert.equal(propre.sessions[1].jetonHache, "[masqué]");
});

test("aucun secret ne survit à la sérialisation", () => {
  const texte = JSON.stringify(expurger({ a: { b: { motDePasse: "MONSECRET" } } }));
  assert.ok(!texte.includes("MONSECRET"));
});

test("l'expurgation ne casse pas sur les valeurs simples ni sur null", () => {
  assert.equal(expurger(null), null);
  assert.equal(expurger(42), 42);
  assert.equal(expurger("texte"), "texte");
  assert.equal(expurger(undefined), undefined);
});

test("une structure profonde est tronquée plutôt que parcourue sans fin", () => {
  // Une référence circulaire ferait boucler indéfiniment un parcours naïf.
  const boucle = { niveau: 1 };
  boucle.soi = boucle;
  assert.doesNotThrow(() => JSON.stringify(expurger(boucle)));
});
