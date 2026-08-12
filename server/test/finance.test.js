// Tests unitaires des formules financières (node:test, sans dépendance).
// Vérification de référence du brief : 14 000 € à 3,9 % sur 60 mois
// → 257,20 €/mois et 1 432 € d'intérêts au total.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mensualite,
  capitalRestant,
  projeter,
  projeterPlafonne,
  echeanceCeMois,
  PAS_PERIODICITE,
  verseAvecPlafond,
  quotePart,
  resteAVivre,
  versementRequis,
} from "../src/finance.js";

const proche = (obtenu, attendu, tolerance, message) =>
  assert.ok(
    Math.abs(obtenu - attendu) <= tolerance,
    `${message} : obtenu ${obtenu}, attendu ${attendu} (±${tolerance})`
  );

/* ─── Mensualité ─── */

test("mensualité de référence : 14 000 € à 3,9 % sur 60 mois → 257,20 €/mois", () => {
  proche(mensualite(14000, 3.9, 60), 257.2, 0.005, "mensualité");
});

test("intérêts totaux de référence : 60 × 257,20 − 14 000 → 1 432 €", () => {
  const interets = mensualite(14000, 3.9, 60) * 60 - 14000;
  proche(interets, 1432, 1, "intérêts totaux");
});

test("mensualité à taux zéro : capital / durée", () => {
  assert.equal(mensualite(1200, 0, 12), 100);
});

test("mensualité nulle si capital ou durée absents", () => {
  assert.equal(mensualite(0, 3.9, 60), 0);
  assert.equal(mensualite(14000, 3.9, 0), 0);
});

test("mensualité en centimes : linéaire, ×100 par rapport aux euros", () => {
  proche(mensualite(1400000, 3.9, 60), mensualite(14000, 3.9, 60) * 100, 1e-6, "linéarité");
});

/* ─── Capital restant dû ─── */

test("capital restant avant la première échéance : le capital emprunté", () => {
  assert.equal(capitalRestant(14000, 3.9, 60, 0), 14000);
  assert.equal(capitalRestant(14000, 3.9, 60, -3), 14000);
});

test("capital restant après la dernière échéance : zéro", () => {
  assert.equal(capitalRestant(14000, 3.9, 60, 60), 0);
  assert.equal(capitalRestant(14000, 3.9, 60, 72), 0);
});

test("capital restant à taux zéro : capital − k mensualités", () => {
  assert.equal(capitalRestant(1200, 0, 12, 5), 700);
});

test("capital restant : cohérent avec l'amortissement simulé mois par mois", () => {
  const [C, taux, n] = [14000, 3.9, 60];
  const r = taux / 100 / 12;
  const M = mensualite(C, taux, n);
  let solde = C;
  for (let k = 1; k < n; k++) {
    solde = solde * (1 + r) - M;
    proche(capitalRestant(C, taux, n, k), solde, 0.01, `échéance ${k}`);
  }
});

test("capital restant : décroissant et borné à [0, capital]", () => {
  let precedent = capitalRestant(9000, 2.4, 48, 0);
  for (let k = 1; k <= 48; k++) {
    const restant = capitalRestant(9000, 2.4, 48, k);
    assert.ok(restant <= precedent, `croissance inattendue à k=${k}`);
    assert.ok(restant >= 0 && restant <= 9000, `hors bornes à k=${k}`);
    precedent = restant;
  }
});

/* ─── Projection d'épargne ─── */

test("projection à rendement nul : valeur + versement × mois", () => {
  assert.equal(projeter(1000, 100, 0, 12), 2200);
});

test("projection sur 0 mois : la valeur actuelle", () => {
  assert.equal(projeter(8400, 150, 2.4, 0), 8400);
});

test("projection : cohérente avec la capitalisation simulée mois par mois", () => {
  const [V, P, rdt] = [8400, 150, 2.4];
  const r = rdt / 100 / 12;
  let valeur = V;
  for (let m = 1; m <= 120; m++) {
    valeur = valeur * (1 + r) + P;
    proche(projeter(V, P, rdt, m), valeur, 0.01, `mois ${m}`);
  }
});

/* ─── Projection plafonnée (livrets réglementés) ─── */

test("projection plafonnée sans plafond : identique à projeter", () => {
  for (const mois of [0, 1, 12, 120]) {
    assert.equal(projeterPlafonne(8400, 150, 2.4, mois, null), projeter(8400, 150, 2.4, mois));
    assert.equal(projeterPlafonne(8400, 150, 2.4, mois, undefined), projeter(8400, 150, 2.4, mois));
  }
});

test("projection plafonnée sans intérêts : la valeur s'arrête au plafond", () => {
  // 1 000 € + 100 €/mois, plafond 1 500 € : atteint en 5 mois, puis plus rien.
  assert.equal(projeterPlafonne(1000, 100, 0, 5, 1500), 1500);
  assert.equal(projeterPlafonne(1000, 100, 0, 60, 1500), 1500);
});

test("projection plafonnée : les intérêts continuent au-delà du plafond", () => {
  // Une fois le plafond atteint, les versements cessent mais pas la capitalisation.
  const apres = projeterPlafonne(1500, 100, 3, 120, 1500);
  assert.ok(apres > 1500, `attendu au-dessus du plafond, obtenu ${apres}`);
  proche(apres, projeter(1500, 0, 3, 120), 1e-9, "capitalisation seule");
});

test("projection plafonnée : versements ignorés si le plafond est déjà dépassé", () => {
  proche(projeterPlafonne(30000, 150, 0, 24, 22950), 30000, 1e-9, "aucun versement");
});

test("projection plafonnée : identique à projeter tant que le plafond n'est pas atteint", () => {
  // 8 400 € + 150 €/mois à 2,4 % reste loin des 22 950 € du Livret A sur 2 ans.
  proche(projeterPlafonne(8400, 150, 2.4, 24, 22950), projeter(8400, 150, 2.4, 24), 0.01, "avant plafond");
});

test("projection plafonnée : Livret A, le plafond borne bien les versements", () => {
  // 20 000 € + 500 €/mois, plafond 22 950 € : le cumul versé se fige près du plafond.
  const verse = verseAvecPlafond(20000, 500, 3, 120, 22950);
  assert.ok(verse >= 22950 - 500 && verse <= 22950, `cumul versé hors bornes : ${verse}`);
});

test("cumul versé sans plafond : valeur de départ + versements", () => {
  assert.equal(verseAvecPlafond(8400, 150, 2.4, 12, null), 8400 + 150 * 12);
});

test("cumul versé : jamais supérieur à la valeur projetée à rendement positif", () => {
  const [V, P, rdt, plafond] = [1000, 200, 2, 22950];
  for (const mois of [1, 12, 60, 240]) {
    const valeur = projeterPlafonne(V, P, rdt, mois, plafond);
    const verse = verseAvecPlafond(V, P, rdt, mois, plafond);
    assert.ok(valeur >= verse, `mois ${mois} : valeur ${valeur} < versé ${verse}`);
  }
});

/* ─── Échéances des lignes récurrentes ─── */

test("sans début ni fin, une récurrente mensuelle tombe tous les mois", () => {
  for (const mois of ["2020-01", "2026-08", "2030-12"]) {
    assert.equal(echeanceCeMois({}, mois), true);
  }
});

test("une récurrente ne tombe pas avant son début", () => {
  const ligne = { debut: "2026-06", periodicite: "mensuel" };
  assert.equal(echeanceCeMois(ligne, "2026-05"), false);
  assert.equal(echeanceCeMois(ligne, "2026-06"), true);
  assert.equal(echeanceCeMois(ligne, "2026-07"), true);
});

test("une récurrente ne tombe plus après sa fin, mais tombe le mois même", () => {
  // Résilier un abonnement ne doit pas l'effacer des mois déjà passés.
  const ligne = { fin: "2026-08", periodicite: "mensuel" };
  assert.equal(echeanceCeMois(ligne, "2026-07"), true);
  assert.equal(echeanceCeMois(ligne, "2026-08"), true, "la fin est incluse");
  assert.equal(echeanceCeMois(ligne, "2026-09"), false);
});

test("un trimestriel tombe un mois sur trois, ancré sur son début", () => {
  const ligne = { debut: "2026-02", periodicite: "trimestriel" };
  const tombe = ["2026-02", "2026-05", "2026-08", "2026-11", "2027-02"];
  const pasTombe = ["2026-03", "2026-04", "2026-06", "2026-07", "2026-12"];
  for (const m of tombe) assert.equal(echeanceCeMois(ligne, m), true, `devrait tomber en ${m}`);
  for (const m of pasTombe) assert.equal(echeanceCeMois(ligne, m), false, `ne devrait pas tomber en ${m}`);
});

test("un annuel ne tombe qu'un mois par an", () => {
  const ligne = { debut: "2026-03", periodicite: "annuel" };
  assert.equal(echeanceCeMois(ligne, "2026-03"), true);
  assert.equal(echeanceCeMois(ligne, "2027-03"), true);
  assert.equal(echeanceCeMois(ligne, "2026-09"), false);
  assert.equal(echeanceCeMois(ligne, "2027-02"), false);
});

test("un semestriel tombe deux fois par an", () => {
  const ligne = { debut: "2026-01", periodicite: "semestriel" };
  const annee = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const echeances = annee.filter((m) => echeanceCeMois(ligne, m));
  assert.deepEqual(echeances, ["2026-01", "2026-07"]);
});

test("début et rythme se combinent avec la fin", () => {
  const ligne = { debut: "2026-01", fin: "2026-12", periodicite: "trimestriel" };
  assert.equal(echeanceCeMois(ligne, "2026-10"), true);
  assert.equal(echeanceCeMois(ligne, "2027-01"), false, "au-delà de la fin, même une échéance ne compte plus");
});

test("un rythme non mensuel sans ancrage retombe sur le mensuel", () => {
  // Cas qui ne devrait pas se produire — la validation exige un début — mais
  // mieux vaut le comportement le moins surprenant qu'un mois arbitraire.
  assert.equal(echeanceCeMois({ periodicite: "annuel" }, "2026-08"), true);
});

test("les pas correspondent aux rythmes annoncés", () => {
  assert.deepEqual(PAS_PERIODICITE, { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 });
});

/* ─── Quote-part ─── */

test("quote-part au prorata des revenus", () => {
  proche(quotePart(2450, 4430, 2, "prorata"), 2450 / 4430, 1e-12, "prorata");
});

test("quote-parts au prorata : la somme fait 1", () => {
  const total = quotePart(2450, 4430, 2, "prorata") + quotePart(1980, 4430, 2, "prorata");
  proche(total, 1, 1e-12, "somme des parts");
});

test("quote-part moitié-moitié : 1/nb membres, quel que soit le revenu", () => {
  assert.equal(quotePart(2450, 4430, 2, "moitie"), 0.5);
  assert.equal(quotePart(0, 4430, 4, "moitie"), 0.25);
});

test("quote-part au prorata avec revenus totaux nuls : zéro", () => {
  assert.equal(quotePart(0, 0, 2, "prorata"), 0);
});

/* ─── Reste à vivre ─── */

test("reste à vivre : revenus moins toutes les sorties", () => {
  assert.equal(
    resteAVivre({
      revenus: 4730,
      depenses: 1810,
      mensualitesCredits: 454,
      versementsProjets: 550,
      versementsPlacements: 350,
    }),
    4730 - 1810 - 454 - 550 - 350
  );
});

test("reste à vivre : peut être négatif", () => {
  assert.ok(
    resteAVivre({ revenus: 1000, depenses: 1500, mensualitesCredits: 0, versementsProjets: 0, versementsPlacements: 0 }) < 0
  );
});

/* ─── Versement requis ─── */

test("versement requis : (objectif − épargné) / mois restants", () => {
  proche(versementRequis(6000, 1850, 14), (6000 - 1850) / 14, 1e-12, "versement requis");
});

test("versement requis : échéance passée ou courante → tout sur un mois", () => {
  assert.equal(versementRequis(1000, 0, 0), 1000);
  assert.equal(versementRequis(1000, 0, -5), 1000);
});

test("versement requis : objectif déjà atteint → zéro", () => {
  assert.equal(versementRequis(1000, 1200, 6), 0);
});
