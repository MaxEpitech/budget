// Analyse des opérations bancaires — tests unitaires, sans réseau ni base.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyserOperations,
  montantEnCentimes,
  normaliser,
  soldePrincipal,
  MOTS_CLES_REVENUS,
} from "../src/banque/analyse.js";

const op = (montant, date, extra = {}) => ({
  bookingDate: date,
  transactionAmount: { amount: montant, currency: "EUR" },
  ...extra,
});

test("les montants sont lus en centimes entiers, sans passer par un flottant", () => {
  assert.equal(montantEnCentimes("12.34"), 1234);
  assert.equal(montantEnCentimes("-12.3"), -1230);
  assert.equal(montantEnCentimes("2450"), 245000);
  assert.equal(montantEnCentimes("0.07"), 7);
  assert.equal(montantEnCentimes("19,99"), 1999);
  // 0,1 + 0,2 en flottant ne fait pas 0,3 : en centimes, si.
  assert.equal(montantEnCentimes("0.1") + montantEnCentimes("0.2"), montantEnCentimes("0.3"));
});

test("un montant illisible est ignoré plutôt que compté pour zéro ou NaN", () => {
  for (const v of [undefined, null, "", "abc", "12.3.4", {}]) assert.equal(montantEnCentimes(v), null);
  const r = analyserOperations([op("abc", "2026-08-01"), op(undefined, "2026-08-01")]);
  assert.equal(r.nbOperations, 0);
});

test("normaliser retire accents et casse", () => {
  assert.equal(normaliser("  Virement   REÇU "), "virement recu");
  assert.equal(normaliser(null), "");
});

test("revenus : opérations positives au libellé reconnu, ramenées au mois", () => {
  const r = analyserOperations([
    op("2450.00", "2026-07-28", { remittanceInformationUnstructured: "SALAIRE JUILLET ACME SAS" }),
    op("2450.00", "2026-08-28", { remittanceInformationUnstructuredArray: ["VIR SEPA", "Salaire août"] }),
    op("2450.00", "2026-09-28", { additionalInformation: "PAYE 09/2026" }),
    // Positif mais sans mot-clé : un remboursement n'est pas un revenu.
    op("86.40", "2026-08-12", { remittanceInformationUnstructured: "REMBOURSEMENT CPAM" }),
  ]);
  assert.equal(r.nbRevenus, 3);
  assert.equal(r.revenusMensuels, 245000, "7 350 € sur trois mois");
});

test("revenus : « Virement reçu » compte, accents et casse indifférents", () => {
  const r = analyserOperations([op("300", "2026-08-03", { remittanceInformationUnstructured: "VIREMENT REÇU DE M. DURAND" })]);
  assert.equal(r.nbRevenus, 1);
  assert.equal(r.revenusMensuels, 10000);
});

test("revenus : un débit ne compte jamais, même s'il parle de salaire", () => {
  const r = analyserOperations([op("-1200", "2026-08-03", { remittanceInformationUnstructured: "SALAIRE NOUNOU" })]);
  assert.equal(r.nbRevenus, 0);
  assert.equal(r.revenusMensuels, 0);
});

test("charges : seules les dépenses retrouvées sur deux mois au moins comptent", () => {
  const r = analyserOperations([
    op("-39.99", "2026-07-05", { creditorName: "Fournisseur Internet" }),
    op("-39.99", "2026-08-05", { creditorName: "FOURNISSEUR INTERNET" }),
    op("-39.99", "2026-09-05", { creditorName: "Fournisseur  Internet" }),
    op("-850.00", "2026-07-02", { creditorName: "Agence du Parc" }),
    op("-850.00", "2026-08-02", { creditorName: "Agence du Parc" }),
    // Achat isolé : ponctuel, donc hors charges courantes.
    op("-1299.00", "2026-08-17", { creditorName: "Magasin de meubles" }),
    // Deux fois le même mois : toujours pas récurrent.
    op("-12.00", "2026-09-01", { creditorName: "Boulangerie" }),
    op("-9.50", "2026-09-20", { creditorName: "Boulangerie" }),
  ]);
  assert.equal(r.nbChargesRecurrentes, 2);
  assert.equal(r.chargesCourantesMensuelles, Math.round((3 * 3999 + 2 * 85000) / 3));
});

test("charges : sans bénéficiaire, le libellé sert de clé une fois ses numéros retirés", () => {
  const r = analyserOperations([
    op("-62.10", "2026-07-10", { remittanceInformationUnstructured: "PRLV SEPA ENERGIE FACT 20260710-4471" }),
    op("-58.30", "2026-08-10", { remittanceInformationUnstructured: "PRLV SEPA ENERGIE FACT 20260810-5120" }),
  ]);
  assert.equal(r.nbChargesRecurrentes, 1);
  assert.equal(r.chargesCourantesMensuelles, Math.round((6210 + 5830) / 3));
});

test("la fenêtre et les mots-clés se règlent", () => {
  const operations = [op("1000", "2026-08-01", { remittanceInformationUnstructured: "PENSION RETRAITE" })];
  assert.equal(analyserOperations(operations).nbRevenus, 0);
  const r = analyserOperations(operations, { jours: 30, motsCles: ["Pension"] });
  assert.equal(r.nbRevenus, 1);
  assert.equal(r.revenusMensuels, 100000, "trente jours : un seul mois");
  assert.ok(MOTS_CLES_REVENUS.includes("salaire"));
});

test("aucune opération : des zéros, pas une erreur", () => {
  for (const entree of [[], null, undefined]) {
    assert.deepEqual(analyserOperations(entree), {
      revenusMensuels: 0,
      chargesCourantesMensuelles: 0,
      nbOperations: 0,
      nbRevenus: 0,
      nbChargesRecurrentes: 0,
    });
  }
});

test("solde principal : le solde comptable passe avant le solde disponible", () => {
  const soldes = [
    { balanceType: "interimAvailable", balanceAmount: { amount: "900.00" } },
    { balanceType: "closingBooked", balanceAmount: { amount: "1520.37" } },
  ];
  assert.equal(soldePrincipal(soldes), 152037);
  assert.equal(soldePrincipal([{ balanceType: "inconnu", balanceAmount: { amount: "-45.10" } }]), -4510);
  assert.equal(soldePrincipal([]), null);
});
