// Tests unitaires des formules financières (node:test, sans dépendance).
// Vérification de référence du brief : 14 000 € à 3,9 % sur 60 mois
// → 257,20 €/mois et 1 432 € d'intérêts au total.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mensualite,
  capitalRestant,
  coutTotal,
  interetsPayes,
  indemniteAnticipee,
  rembourserParAnticipation,
  cotisationAssurance,
  assurancePayee,
  echeanceTotale,
  moisAvantPlafond,
  projeter,
  projeterPlafonne,
  echeanceCeMois,
  PAS_PERIODICITE,
  verseAvecPlafond,
  quotePart,
  resteAVivre,
  versementRequis,
  totauxDuMois,
  repartirParMembre,
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

/* ─── Coût d'un crédit ─── */

test("coût total de référence : 14 000 € à 3,9 % sur 60 mois → 1 432 €", () => {
  proche(coutTotal(14000, 3.9, 60), 1432, 1, "coût total");
});

test("coût total à taux zéro : rien", () => {
  assert.equal(coutTotal(10000, 0, 60), 0);
});

test("coût total nul si capital ou durée absents", () => {
  assert.equal(coutTotal(0, 3.9, 60), 0);
  assert.equal(coutTotal(14000, 3.9, 0), 0);
});

test("intérêts payés : rien avant la première échéance", () => {
  assert.equal(interetsPayes(14000, 3.9, 60, 0), 0);
  assert.equal(interetsPayes(14000, 3.9, 60, -3), 0);
});

test("intérêts payés au terme : le coût total du crédit", () => {
  proche(interetsPayes(14000, 3.9, 60, 60), coutTotal(14000, 3.9, 60), 1e-6, "intérêts au terme");
});

test("intérêts payés au-delà du terme : plafonnés au coût total", () => {
  proche(interetsPayes(14000, 3.9, 60, 900), coutTotal(14000, 3.9, 60), 1e-6, "intérêts au-delà");
});

test("intérêts payés : cohérents avec l'amortissement simulé mois par mois", () => {
  const capital = 105000, taux = 3.5, duree = 300, k = 26;
  const r = taux / 100 / 12;
  const M = mensualite(capital, taux, duree);
  let restant = capital, cumul = 0;
  for (let i = 0; i < k; i++) {
    const interet = restant * r;
    cumul += interet;
    restant -= M - interet;
  }
  proche(interetsPayes(capital, taux, duree, k), cumul, 0.01, "intérêts payés");
});

test("intérêts payés : croissants, et toujours sous le coût total", () => {
  const total = coutTotal(105000, 3.5, 300);
  let precedent = -1;
  for (let k = 0; k <= 300; k += 10) {
    const paye = interetsPayes(105000, 3.5, 300, k);
    assert.ok(paye >= precedent, `intérêts payés en recul à k=${k}`);
    assert.ok(paye <= total + 1e-6, `intérêts payés au-dessus du coût total à k=${k}`);
    precedent = paye;
  }
});

test("intérêts payés à taux zéro : rien, à toute échéance", () => {
  assert.equal(interetsPayes(12000, 0, 24, 12), 0);
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

/* ─── Remboursement anticipé ─── */

const PRET = { capital: 105000, tauxAnnuel: 3.5, dureeMois: 300, echeancesPayees: 26 };

test("remboursement anticipé : null quand le versement n'a pas de sens", () => {
  for (const versement of [0, -1000, Number.NaN]) {
    assert.equal(rembourserParAnticipation({ ...PRET, versement }), null, `versement ${versement}`);
  }
});

test("remboursement anticipé : null si le versement solde le crédit", () => {
  const restant = capitalRestant(105000, 3.5, 300, 26);
  assert.equal(rembourserParAnticipation({ ...PRET, versement: restant }), null);
  assert.equal(rembourserParAnticipation({ ...PRET, versement: restant + 1 }), null);
});

test("remboursement anticipé : null sur un crédit déjà arrivé à terme", () => {
  assert.equal(rembourserParAnticipation({ ...PRET, echeancesPayees: 300, versement: 5000 }), null);
});

test("remboursement anticipé : le scénario sans rien faire retrouve les intérêts restants", () => {
  const r = rembourserParAnticipation({ ...PRET, versement: 5000 });
  const restants = coutTotal(105000, 3.5, 300) - interetsPayes(105000, 3.5, 300, 26);
  proche(r.interetsSansRien, restants, 1, "intérêts restants");
});

test("remboursement anticipé : raccourcir la durée économise plus que baisser la mensualité", () => {
  const r = rembourserParAnticipation({ ...PRET, versement: 5000 });
  assert.ok(
    r.surDuree.economie > r.surMensualite.economie,
    `durée ${r.surDuree.economie} vs mensualité ${r.surMensualite.economie}`
  );
});

test("remboursement anticipé sur la durée : mensualité inchangée, échéances en moins", () => {
  const r = rembourserParAnticipation({ ...PRET, versement: 5000 });
  assert.ok(r.surDuree.moisGagnes > 0, "aucun mois gagné");
  assert.equal(r.surDuree.echeances + r.surDuree.moisGagnes, r.echeancesRestantes);
});

test("remboursement anticipé sur la mensualité : durée inchangée, échéance en baisse", () => {
  const r = rembourserParAnticipation({ ...PRET, versement: 5000 });
  assert.ok(r.surMensualite.baisse > 0, "la mensualité ne baisse pas");
  proche(
    r.surMensualite.mensualite,
    mensualite(r.restantApres, 3.5, r.echeancesRestantes),
    1e-9,
    "nouvelle mensualité"
  );
});

test("remboursement anticipé : plus on verse, plus on gagne", () => {
  let moisPrecedent = -1, economiePrecedente = -1;
  for (const versement of [1000, 5000, 10000, 20000, 40000]) {
    const r = rembourserParAnticipation({ ...PRET, versement });
    assert.ok(r.surDuree.moisGagnes >= moisPrecedent, `mois gagnés en recul à ${versement}`);
    assert.ok(r.surDuree.economie >= economiePrecedente, `économie en recul à ${versement}`);
    moisPrecedent = r.surDuree.moisGagnes;
    economiePrecedente = r.surDuree.economie;
  }
});

test("remboursement anticipé à taux zéro : des mois gagnés, aucun intérêt économisé", () => {
  const r = rembourserParAnticipation({ capital: 12000, tauxAnnuel: 0, dureeMois: 24, echeancesPayees: 0, versement: 3000 });
  assert.equal(r.surDuree.moisGagnes, 6); // 3 000 € à 500 €/mois
  proche(r.surDuree.economie, 0, 1e-9, "économie à taux zéro");
  proche(r.surMensualite.economie, 0, 1e-9, "économie à taux zéro");
});

test("remboursement anticipé : le capital est bien remboursé, à l'euro près", () => {
  const r = rembourserParAnticipation({ ...PRET, versement: 5000 });
  // Ce qui est versé au total couvre exactement le capital restant et ses intérêts.
  const verseSurDuree = r.surDuree.interets + r.restantApres;
  proche(verseSurDuree - r.surDuree.interets, r.restantAvant - 5000, 1e-6, "capital amorti");
});

test("indemnité : c'est le semestre d'intérêts qui mord aux taux courants", () => {
  // À 3,5 %, le plafond de 3 % ne peut jamais s'appliquer : il faudrait verser
  // 6R/t, soit 1,7 fois le capital restant dû. Le semestre décide donc seul.
  proche(indemniteAnticipee(5000, 99083, 3.5), 5000 * (3.5 / 100 / 12) * 6, 1e-9, "semestre d'intérêts");
  proche(indemniteAnticipee(90000, 99083, 3.5), 90000 * (3.5 / 100 / 12) * 6, 1e-9, "semestre d'intérêts");
});

test("indemnité : le plafond de 3 % prend le relais quand le taux est élevé", () => {
  // À 12 %, un semestre d'intérêts sur 80 000 € vaut 4 800 € : le plafond mord.
  proche(indemniteAnticipee(80000, 99083, 12), 99083 * 0.03, 1e-9, "plafond de 3 %");
});

test("indemnité : nulle à taux zéro, et jamais négative", () => {
  assert.equal(indemniteAnticipee(5000, 99083, 0), 0);
  assert.equal(indemniteAnticipee(-5000, 99083, 3.5), 0);
});

/* ─── Répartition par membre ─── */

const FOYER = {
  membres: [{ id: "a", nom: "Maxime", revenu: 3000 }, { id: "b", nom: "Estelle", revenu: 1000 }],
  transactions: [{ type: "depense", pour: "foyer", recurrent: true, periodicite: "mensuel", debut: null, fin: null, montant: 1000 }],
  projets: [],
  placements: [],
  credits: [],
  repartition: "prorata",
};

test("répartition : sans charge nominative, chacun paie sa quote-part", () => {
  const [maxime, estelle] = repartirParMembre(FOYER, "2026-08");
  proche(maxime.du, 750, 1e-9, "quote-part de 75 %");
  proche(estelle.du, 250, 1e-9, "quote-part de 25 %");
  assert.equal(maxime.perso, 0);
});

test("répartition : un crédit nominatif pèse sur son porteur, pas sur le foyer", () => {
  const credit = { capital: 12000, taux: 0, duree: 24, debut: "2026-01", pour: "b" };
  const [maxime, estelle] = repartirParMembre({ ...FOYER, credits: [credit] }, "2026-08");

  // 500 €/mois de mensualité : ils sortent entièrement du reste à vivre
  // d'Estelle, et n'entrent pas dans la quote-part de Maxime.
  proche(estelle.perso, 500, 1e-9, "la mensualité revient à Estelle");
  assert.equal(maxime.perso, 0);
  proche(maxime.du, 750, 1e-9, "la quote-part de Maxime ne bouge pas");
});

test("répartition : le même crédit laissé au foyer se partage", () => {
  const credit = { capital: 12000, taux: 0, duree: 24, debut: "2026-01", pour: "foyer" };
  const [maxime, estelle] = repartirParMembre({ ...FOYER, credits: [credit] }, "2026-08");
  assert.equal(estelle.perso, 0);
  proche(maxime.du, 1125, 1e-9, "75 % de 1 500 €");
  proche(estelle.du, 375, 1e-9, "25 % de 1 500 €");
});

test("répartition : un crédit sans « pour » vaut « foyer »", () => {
  const sans = { capital: 12000, taux: 0, duree: 24, debut: "2026-01" };
  const avec = { ...sans, pour: "foyer" };
  assert.deepEqual(
    repartirParMembre({ ...FOYER, credits: [sans] }, "2026-08"),
    repartirParMembre({ ...FOYER, credits: [avec] }, "2026-08")
  );
});

test("répartition : un support nominatif pèse sur son propriétaire", () => {
  const [maxime, estelle] = repartirParMembre(
    { ...FOYER, placements: [{ versement: 200, pour: "a" }] },
    "2026-08"
  );
  proche(maxime.perso, 200, 1e-9, "le versement revient à Maxime");
  assert.equal(estelle.perso, 0);
  proche(estelle.du, 250, 1e-9, "la quote-part d'Estelle ne bouge pas");
});

test("répartition : le crédit soldé ne pèse sur personne", () => {
  const credit = { capital: 12000, taux: 0, duree: 24, debut: "2020-01", pour: "b" };
  const [, estelle] = repartirParMembre({ ...FOYER, credits: [credit] }, "2026-08");
  assert.equal(estelle.perso, 0);
});

test("répartition : l'assurance d'un crédit nominatif suit le crédit", () => {
  const base = { capital: 12000, taux: 0, duree: 24, debut: "2026-01", pour: "b" };
  const sans = repartirParMembre({ ...FOYER, credits: [base] }, "2026-08")[1].perso;
  const avec = repartirParMembre({ ...FOYER, credits: [{ ...base, assuranceTaux: 0.6, assuranceBase: "initial" }] }, "2026-08")[1].perso;
  proche(avec - sans, 12000 * (0.6 / 100 / 12), 1e-9, "cotisation d'assurance");
});

test("répartition : ce qui est nominatif sort de la quote-part, jamais des deux côtés", () => {
  const credit = { capital: 12000, taux: 0, duree: 24, debut: "2026-01", pour: "b" };
  const commun = repartirParMembre({ ...FOYER, credits: [{ ...credit, pour: "foyer" }] }, "2026-08");
  const nominatif = repartirParMembre({ ...FOYER, credits: [credit] }, "2026-08");
  // Le foyer sort la même somme dans les deux cas : seule sa répartition change.
  const total = (r) => r.reduce((s, m) => s + m.du + m.perso, 0);
  proche(total(commun), total(nominatif), 1e-9, "somme des charges");
});

/* ─── Assurance emprunteur ─── */

test("assurance : sans taux, rien — et la mensualité reste la mensualité", () => {
  assert.equal(cotisationAssurance(105000, 99083, 0, "initial"), 0);
  assert.equal(assurancePayee(105000, 3.5, 300, 0, "initial", 26), 0);
  assert.equal(echeanceTotale(105000, 3.5, 300, 0, "initial", 26), mensualite(105000, 3.5, 300));
});

test("assurance sur capital initial : cotisation constante, quelle que soit l'échéance", () => {
  const attendue = 105000 * (0.34 / 100 / 12);
  for (const k of [0, 26, 150, 299]) {
    const restant = capitalRestant(105000, 3.5, 300, k);
    proche(cotisationAssurance(105000, restant, 0.34, "initial"), attendue, 1e-9, `échéance ${k}`);
  }
});

test("assurance sur capital restant dû : cotisation décroissante", () => {
  let precedente = Infinity;
  for (const k of [0, 50, 100, 200, 299]) {
    const restant = capitalRestant(105000, 3.5, 300, k);
    const cotisation = cotisationAssurance(105000, restant, 0.34, "restant");
    assert.ok(cotisation < precedente, `cotisation non décroissante à l'échéance ${k}`);
    precedente = cotisation;
  }
});

test("assurance : la base dégressive coûte moins que la base initiale", () => {
  const surInitial = assurancePayee(105000, 3.5, 300, 0.34, "initial", 300);
  const surRestant = assurancePayee(105000, 3.5, 300, 0.34, "restant", 300);
  assert.ok(surRestant < surInitial, `${surRestant} devrait être sous ${surInitial}`);
  // Sur vingt-cinq ans l'écart est considérable : c'est ce qui justifie de
  // demander la base plutôt que d'en supposer une.
  assert.ok(surInitial / surRestant > 1.5, `écart trop faible : ${surInitial / surRestant}`);
});

test("assurance payée : somme des cotisations, échéance par échéance", () => {
  let cumul = 0;
  for (let i = 0; i < 26; i++) {
    cumul += cotisationAssurance(105000, capitalRestant(105000, 3.5, 300, i), 0.34, "restant");
  }
  proche(assurancePayee(105000, 3.5, 300, 0.34, "restant", 26), cumul, 1e-9, "assurance payée");
});

test("assurance payée : bornée au terme, jamais négative", () => {
  const auTerme = assurancePayee(105000, 3.5, 300, 0.34, "initial", 300);
  proche(assurancePayee(105000, 3.5, 300, 0.34, "initial", 900), auTerme, 1e-9, "au-delà du terme");
  assert.equal(assurancePayee(105000, 3.5, 300, 0.34, "initial", -5), 0);
});

test("échéance totale : mensualité plus cotisation, sur la bonne assiette", () => {
  const M = mensualite(105000, 3.5, 300);
  proche(echeanceTotale(105000, 3.5, 300, 0.34, "initial", 26), M + 105000 * (0.34 / 100 / 12), 1e-9, "base initiale");
  const restant = capitalRestant(105000, 3.5, 300, 26);
  proche(echeanceTotale(105000, 3.5, 300, 0.34, "restant", 26), M + restant * (0.34 / 100 / 12), 1e-9, "base restante");
});

test("assurance : le total du mois la compte, et un crédit soldé ne la compte plus", () => {
  const credit = { capital: 105000, taux: 3.5, duree: 300, debut: "2024-06", assuranceTaux: 0.34, assuranceBase: "initial" };
  const avec = totauxDuMois({ credits: [credit] }, "2026-08");
  const sans = totauxDuMois({ credits: [{ ...credit, assuranceTaux: 0 }] }, "2026-08");
  proche(avec.credits - sans.credits, 105000 * (0.34 / 100 / 12), 1e-9, "assurance dans le total");
  // Un mois postérieur au terme : plus de mensualité, plus d'assurance.
  assert.equal(totauxDuMois({ credits: [credit] }, "2050-01").credits, 0);
});

/* ─── Échéance de plafond ─── */

test("plafond : null quand il n'y en a pas", () => {
  assert.equal(moisAvantPlafond(1000, 100, 2, null), null);
});

test("plafond : zéro quand il est déjà atteint ou dépassé", () => {
  assert.equal(moisAvantPlafond(23000, 150, 2.4, 22950), 0);
  assert.equal(moisAvantPlafond(22950, 150, 2.4, 22950), 0);
});

test("plafond sans intérêts : le nombre de versements qui manquent", () => {
  // 1 000 € + 100 €/mois vers 1 500 € → cinq versements.
  assert.equal(moisAvantPlafond(1000, 100, 0, 1500), 5);
});

test("plafond : null si rien ne fait monter la valeur", () => {
  assert.equal(moisAvantPlafond(1000, 0, 0, 5000), null);
});

test("plafond atteint par les seuls intérêts, sans versement", () => {
  const mois = moisAvantPlafond(1000, 0, 12, 1010);
  assert.ok(mois !== null && mois >= 1 && mois <= 12, `atteint en ${mois} mois`);
});

test("plafond : l'échéance annoncée concorde avec la projection plafonnée", () => {
  const valeur = 8400, versement = 150, rendement = 2.4, plafond = 22950;
  const mois = moisAvantPlafond(valeur, versement, rendement, plafond);
  assert.ok(mois > 0, "échéance attendue");
  assert.ok(
    projeterPlafonne(valeur, versement, rendement, mois - 1, plafond) < plafond,
    "le plafond serait déjà atteint un mois plus tôt"
  );
  assert.ok(
    projeterPlafonne(valeur, versement, rendement, mois, plafond) >= plafond,
    "le plafond n'est pas atteint à l'échéance annoncée"
  );
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

/* ─── Salaire de référence et salaire réel ─── */

const paie = (pour, montant, extra = {}) => ({ type: "revenu", categorie: "Salaire", pour, recurrent: false, mois: "2026-08", montant, ...extra });

test("salaires : sans paie dans le flux, le salaire de référence compte", () => {
  const t = totauxDuMois(FOYER, "2026-08");
  assert.deepEqual([t.salaires, t.revenus], [4000, 4000]);
});

test("salaires : la paie du flux remplace la référence de sa personne, et d'elle seule", () => {
  const foyer = { ...FOYER, transactions: [...FOYER.transactions, paie("a", 2700), paie("a", 150)] };
  const t = totauxDuMois(foyer, "2026-08");
  assert.equal(t.salaires, 2850 + 1000, "Maxime : 2 850 € reçus au lieu de 3 000 ; Estelle garde sa référence");
  assert.equal(t.revenus, 3850, "la paie n'est pas comptée une seconde fois parmi les autres revenus");

  const [maxime, estelle] = repartirParMembre(foyer, "2026-08");
  assert.deepEqual([maxime.revenu, maxime.salaireReference, maxime.salaireReel], [2850, 3000, true]);
  assert.deepEqual([estelle.revenu, estelle.salaireReel], [1000, false]);
  assert.equal(maxime.bonus, 0, "la paie n'est pas un bonus");
  proche(maxime.part, 2850 / 3850, 1e-12, "la quote-part suit le revenu réel");
});

test("salaires : une prime ne remplace rien, un salaire attribué au foyer non plus", () => {
  const foyer = {
    ...FOYER,
    transactions: [...FOYER.transactions, paie("a", 300, { categorie: "Autre" }), paie("foyer", 500)],
  };
  const t = totauxDuMois(foyer, "2026-08");
  assert.deepEqual([t.salaires, t.revenus], [4000, 4800]);
  const [maxime] = repartirParMembre(foyer, "2026-08");
  assert.deepEqual([maxime.revenu, maxime.bonus], [3000, 300]);
});

test("salaires : la paie d'un autre mois ne remplace pas celle de ce mois-ci", () => {
  const foyer = { ...FOYER, transactions: [...FOYER.transactions, paie("a", 2700, { mois: "2026-07" })] };
  assert.equal(totauxDuMois(foyer, "2026-08").salaires, 4000);
  assert.equal(totauxDuMois(foyer, "2026-07").salaires, 3700);
});
