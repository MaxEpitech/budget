// Validation et conversion d'un crédit assuré — fonctions pures, sans base.
//
// Ces tests couvrent la frontière de l'API : ce que le client a le droit
// d'envoyer, et ce qui est réellement écrit en base. C'est là que se joue la
// compatibilité avec les crédits saisis avant l'assurance, dont la requête ne
// porte pas ces champs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CreditSchema } from "../src/schemas.js";
import { creditVersDb, creditVersApi } from "../src/conversion.js";

const CREDIT = { libelle: "Prêt immo", capital: 105000, taux: 3.5, duree: 300, debut: "2024-06" };

test("un crédit sans assurance reste valide : les champs sont facultatifs", () => {
  const r = CreditSchema.safeParse(CREDIT);
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("un crédit sans assurance est écrit avec un taux nul et la base par défaut", () => {
  const enBase = creditVersDb(CREDIT);
  assert.equal(enBase.assuranceTaux, 0);
  assert.equal(enBase.assuranceBase, "initial");
});

test("les deux bases d'assurance sont acceptées, et elles seules", () => {
  for (const assuranceBase of ["initial", "restant"]) {
    assert.ok(CreditSchema.safeParse({ ...CREDIT, assuranceTaux: 0.34, assuranceBase }).success, assuranceBase);
  }
  const r = CreditSchema.safeParse({ ...CREDIT, assuranceTaux: 0.34, assuranceBase: "degressif" });
  assert.equal(r.success, false, "une base inconnue devrait être refusée");
  assert.match(r.error.issues[0].message, /base d'assurance/);
});

test("un taux d'assurance négatif est refusé", () => {
  const r = CreditSchema.safeParse({ ...CREDIT, assuranceTaux: -0.2 });
  assert.equal(r.success, false);
});

test("le taux d'assurance traverse la conversion sans être converti en centimes", () => {
  // C'est un pourcentage, pas un montant : le passer par enCentimes le
  // multiplierait par cent et l'assurance coûterait cent fois trop cher.
  const enBase = creditVersDb({ ...CREDIT, assuranceTaux: 0.34, assuranceBase: "restant" });
  assert.equal(enBase.assuranceTaux, 0.34);
  assert.equal(enBase.assuranceBase, "restant");
  assert.equal(enBase.capital, 10500000); // le capital, lui, est bien en centimes
});

test("l'assurance revient telle quelle vers le client", () => {
  const vers = creditVersApi({
    id: "c1", libelle: "Prêt immo", capital: 10500000, taux: 3.5,
    dureeMois: 300, moisDebut: "2024-06", assuranceTaux: 0.34, assuranceBase: "restant",
  });
  assert.equal(vers.assuranceTaux, 0.34);
  assert.equal(vers.assuranceBase, "restant");
  assert.equal(vers.capital, 105000);
});
