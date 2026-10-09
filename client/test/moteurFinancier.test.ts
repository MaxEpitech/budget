// Tests unitaires du moteur de capacité d'emprunt (node:test, sans dépendance).
//
// Référence reprise des tests du serveur : 14 000 € à 3,9 % sur 60 mois donnent
// 257,20 €/mois. Les attendus sont recalculés ici par un chemin indépendant du
// moteur — amortissement rejoué pas à pas — plutôt que recopiés de sa sortie.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculerFinance,
  simulerCreditConso,
  dureeRestante,
  loyerRetenuBanque,
  capitalEmpruntable,
  prixBienMax,
} from "../src/moteur/moteurFinancier.ts";
import type { BudgetInput } from "../src/moteur/moteurFinancier.ts";
import { mensualite, capitalRestant } from "../src/finance.js";

const proche = (obtenu: number, attendu: number, tolerance: number, message: string) =>
  assert.ok(
    Math.abs(obtenu - attendu) <= tolerance,
    `${message} : obtenu ${obtenu}, attendu ${attendu} (±${tolerance})`,
  );

type Conso = BudgetInput["creditConsommation"];

const conso = (surcharge: Partial<Conso> = {}): Conso => ({
  aUnCreditConso: true,
  capitalEmprunte: 14000,
  taeg: 3.9,
  dureeInitialeMois: 60,
  strategieAnticipation: { injectionsAnnuellesFixes: 0, epargneMensuelleDediee: 0 },
  horizonSimulationMois: 24,
  seuilNeutralisationMois: 12,
  ...surcharge,
});

const foyerType = (surcharge: Partial<BudgetInput> = {}): BudgetInput => ({
  foyer: { emprunteurPrincipalNet: 3000, coEmprunteurNet: 2000, chargesCourantesFixes: 1500 },
  immobilierActuel: {
    aUnCreditEnCours: true,
    mensualiteActuelle: 600,
    seraMisEnLocation: true,
    loyerBrutEstime: 1000,
    decoteLocativeBanque: 30,
  },
  creditConsommation: conso(),
  projetImmobilier: {
    apportTotalDisponible: 30000,
    tauxInteretEstime: 3.5,
    tauxAssuranceEstime: 0.3,
    fraisAnnexesEstimesPourcent: 8,
  },
  ...surcharge,
});

/* ─── A. Crédit à la consommation ─── */

test("sans anticipation, le crédit suit son tableau d'amortissement", () => {
  const r = simulerCreditConso(conso());
  proche(r.mensualiteInitiale, 257.2, 0.005, "mensualité");
  proche(r.capitalRestantDu, capitalRestant(14000, 3.9, 60, 24), 0.01, "capital restant dû");
  assert.equal(r.moisRestants, 36, "60 mois moins les 24 écoulés");
  assert.equal(r.neutraliseParLaBanque, false);
});

test("le seuil de neutralisation est inclus", () => {
  assert.equal(simulerCreditConso(conso({ seuilNeutralisationMois: 36 })).neutraliseParLaBanque, true);
  assert.equal(simulerCreditConso(conso({ seuilNeutralisationMois: 35 })).neutraliseParLaBanque, false);
});

test("les versements anticipés raccourcissent la durée sans toucher à la mensualité", () => {
  const sans = simulerCreditConso(conso());
  const avec = simulerCreditConso(
    conso({ strategieAnticipation: { injectionsAnnuellesFixes: 1000, epargneMensuelleDediee: 100 } }),
  );
  assert.equal(avec.mensualiteInitiale, sans.mensualiteInitiale, "mensualité strictement identique");

  // Rejoué à la main : 12 échéances, 2 200 € versés, 12 échéances, 2 200 € versés.
  const taux = 3.9 / 100 / 12;
  const M = mensualite(14000, 3.9, 60);
  let attendu = 14000;
  for (let mois = 1; mois <= 24; mois++) {
    attendu = attendu * (1 + taux) - M;
    if (mois % 12 === 0) attendu -= 1000 + 100 * 12;
  }
  proche(avec.capitalRestantDu, attendu, 0.01, "capital restant dû");
  assert.ok(avec.moisRestants < sans.moisRestants, "la durée doit baisser");
});

test("la durée restante annoncée est bien celle qu'il faut pour solder", () => {
  const r = simulerCreditConso(
    conso({ strategieAnticipation: { injectionsAnnuellesFixes: 1000, epargneMensuelleDediee: 100 } }),
  );
  const taux = 3.9 / 100 / 12;
  let restant = r.capitalRestantDu;
  let echeances = 0;
  while (restant > 1e-6) {
    restant = Math.max(0, restant * (1 + taux) - r.mensualiteInitiale);
    echeances += 1;
    assert.ok(echeances < 1000, "le crédit ne se solde jamais");
  }
  assert.equal(r.moisRestants, echeances);
});

test("les versements tombent à la date anniversaire, pas avant", () => {
  const strategieAnticipation = { injectionsAnnuellesFixes: 2000, epargneMensuelleDediee: 0 };
  const onze = simulerCreditConso(conso({ horizonSimulationMois: 11, strategieAnticipation }));
  const douze = simulerCreditConso(conso({ horizonSimulationMois: 12, strategieAnticipation }));
  proche(onze.capitalRestantDu, capitalRestant(14000, 3.9, 60, 11), 0.01, "aucun versement avant douze mois");
  proche(douze.capitalRestantDu, capitalRestant(14000, 3.9, 60, 12) - 2000, 0.01, "versement au douzième mois");
});

test("un versement supérieur au capital restant solde le crédit, sans passer en négatif", () => {
  const r = simulerCreditConso(
    conso({ strategieAnticipation: { injectionsAnnuellesFixes: 50000, epargneMensuelleDediee: 0 } }),
  );
  assert.equal(r.capitalRestantDu, 0);
  assert.equal(r.moisRestants, 0);
  assert.equal(r.neutraliseParLaBanque, true);
});

test("un crédit arrivé à terme avant le mois cible est soldé", () => {
  const r = simulerCreditConso(conso({ horizonSimulationMois: 72 }));
  assert.equal(r.capitalRestantDu, 0);
  assert.equal(r.moisRestants, 0);
});

test("sans crédit à la consommation, rien ne pèse", () => {
  assert.deepEqual(simulerCreditConso(conso({ aUnCreditConso: false })), {
    mensualiteInitiale: 0,
    capitalRestantDu: 0,
    moisRestants: 0,
    neutraliseParLaBanque: true,
  });
});

test("durée restante : taux nul, capital nul, mensualité insuffisante", () => {
  assert.equal(dureeRestante(1200, 0, 100), 12);
  assert.equal(dureeRestante(1250, 0, 100), 13, "la dernière échéance est partielle");
  assert.equal(dureeRestante(0, 3.9, 100), 0);
  assert.equal(dureeRestante(100000, 12, 500), Infinity, "500 € ne couvrent pas 1 000 € d'intérêts");
});

/* ─── B. Endettement ─── */

test("loyer retenu : décote appliquée, et rien si le bien n'est pas loué", () => {
  const immobilier = foyerType().immobilierActuel;
  proche(loyerRetenuBanque(immobilier), 700, 1e-9, "règle des 70 %");
  assert.equal(loyerRetenuBanque({ ...immobilier, seraMisEnLocation: false }), 0);
  assert.equal(loyerRetenuBanque({ ...immobilier, loyerBrutEstime: undefined }), 0);
});

test("endettement : 35 % des revenus retenus, moins les crédits encore comptés", () => {
  const { analyseEndettement: a, consoAuMoisCible: c } = calculerFinance(foyerType());
  proche(a.revenusRetenusBanque, 5700, 1e-9, "3 000 + 2 000 + 700");
  proche(a.mensualiteMaxImmo, 5700 * 0.35 - 600 - c.mensualiteInitiale, 1e-9, "1 995 − 600 − 257,20");
  proche(a.tauxEndettementAvantProjet, ((600 + c.mensualiteInitiale) / 5700) * 100, 1e-9, "avant projet");
  proche(a.tauxEndettementApresProjet, 35, 1e-9, "le projet consomme exactement l'enveloppe");
});

test("un crédit conso neutralisé libère sa mensualité pour le projet", () => {
  const base = calculerFinance(foyerType());
  const neutralise = calculerFinance(foyerType({ creditConsommation: conso({ seuilNeutralisationMois: 36 }) }));
  assert.equal(neutralise.consoAuMoisCible.neutraliseParLaBanque, true);
  proche(
    neutralise.analyseEndettement.mensualiteMaxImmo - base.analyseEndettement.mensualiteMaxImmo,
    base.consoAuMoisCible.mensualiteInitiale,
    1e-9,
    "gain de mensualité",
  );
});

test("profil solo : le co-emprunteur est facultatif", () => {
  const solo = calculerFinance(
    foyerType({ foyer: { emprunteurPrincipalNet: 3000, chargesCourantesFixes: 1500 } }),
  );
  proche(solo.analyseEndettement.revenusRetenusBanque, 3700, 1e-9, "3 000 + 700");
});

test("charges déjà au-dessus du plafond : aucune mensualité disponible", () => {
  const sature = calculerFinance(
    foyerType({
      foyer: { emprunteurPrincipalNet: 1500, chargesCourantesFixes: 800 },
      immobilierActuel: { ...foyerType().immobilierActuel, seraMisEnLocation: false },
    }),
  );
  assert.equal(sature.analyseEndettement.mensualiteMaxImmo, 0);
  assert.ok(sature.analyseEndettement.tauxEndettementAvantProjet > 35);
  assert.equal(
    sature.analyseEndettement.tauxEndettementApresProjet,
    sature.analyseEndettement.tauxEndettementAvantProjet,
  );
  assert.equal(sature.enveloppesAchat.sur20Ans.capitalEmpruntable, 0);
});

test("le plafond d'endettement et les durées se règlent", () => {
  const r = calculerFinance(foyerType(), { tauxEndettementMax: 33, dureesPretMois: [180, 240] });
  proche(r.analyseEndettement.tauxEndettementApresProjet, 33, 1e-9, "plafond réglé à 33 %");
  proche(
    r.enveloppesAchat.sur25Ans.capitalEmpruntable,
    calculerFinance(foyerType(), { tauxEndettementMax: 33 }).enveloppesAchat.sur20Ans.capitalEmpruntable,
    1e-6,
    "la seconde durée vaut ici 240 mois",
  );
});

/* ─── C. Capacité d'achat ─── */

test("capital empruntable : la mensualité couvre exactement le prêt et l'assurance", () => {
  for (const duree of [240, 300]) {
    const capital = capitalEmpruntable(1000, 3.5, 0.3, duree);
    const echeance = mensualite(capital, 3.5, duree) + (capital * 0.3) / 100 / 12;
    proche(echeance, 1000, 1e-6, `aller-retour sur ${duree} mois`);
  }
});

test("capital empruntable : taux nul, et sans assurance", () => {
  proche(capitalEmpruntable(1000, 0, 0, 240), 240000, 1e-6, "taux nul");
  proche(mensualite(capitalEmpruntable(1000, 3.5, 0, 240), 3.5, 240), 1000, 1e-6, "sans assurance");
  assert.equal(capitalEmpruntable(0, 3.5, 0.3, 240), 0);
});

test("prix du bien : l'emprunt et l'apport financent aussi les frais", () => {
  proche(prixBienMax(200000, 30000, 8), 230000 / 1.08, 1e-9, "prix maximal");
  const prix = prixBienMax(200000, 30000, 8);
  proche(prix + prix * 0.08, 230000, 1e-6, "prix + frais = financement");
});

test("emprunter sur 25 ans permet d'acheter plus cher que sur 20", () => {
  const { enveloppesAchat: e } = calculerFinance(foyerType());
  assert.ok(e.sur25Ans.capitalEmpruntable > e.sur20Ans.capitalEmpruntable);
  assert.ok(e.sur25Ans.prixBienMax > e.sur20Ans.prixBienMax);
  proche(
    e.sur20Ans.prixBienMax,
    (e.sur20Ans.capitalEmpruntable + 30000) / 1.08,
    1e-6,
    "apport et frais intégrés",
  );
});

/* ─── Budget quotidien ─── */

test("budget quotidien : loyer brut et mensualités réellement payées", () => {
  const r = calculerFinance(foyerType());
  const b = r.budgetQuotidienApresProjet;
  proche(b.totalEntreesReelles, 3000 + 2000 + 1000, 1e-9, "le loyer entre pour sa valeur réelle");
  proche(
    b.totalSortiesReelles,
    1500 + 600 + r.consoAuMoisCible.mensualiteInitiale + r.analyseEndettement.mensualiteMaxImmo,
    1e-9,
    "sorties",
  );
  proche(b.resteAVivreReelFoyer, b.totalEntreesReelles - b.totalSortiesReelles, 1e-9, "reste à vivre");
});

test("budget quotidien : un crédit neutralisé par la banque continue d'être payé", () => {
  const r = calculerFinance(foyerType({ creditConsommation: conso({ seuilNeutralisationMois: 36 }) }));
  const sortiesHorsConso = 1500 + 600 + r.analyseEndettement.mensualiteMaxImmo;
  proche(
    r.budgetQuotidienApresProjet.totalSortiesReelles - sortiesHorsConso,
    r.consoAuMoisCible.mensualiteInitiale,
    1e-9,
    "la mensualité conso sort toujours du compte",
  );
});

/* ─── Robustesse ─── */

test("une saisie incomplète ne produit jamais de NaN", () => {
  const abime = foyerType({
    foyer: { emprunteurPrincipalNet: NaN, coEmprunteurNet: -500, chargesCourantesFixes: NaN },
    creditConsommation: conso({ capitalEmprunte: NaN, taeg: -1, dureeInitialeMois: 0 }),
    projetImmobilier: {
      apportTotalDisponible: NaN,
      tauxInteretEstime: NaN,
      tauxAssuranceEstime: NaN,
      fraisAnnexesEstimesPourcent: NaN,
    },
  });
  const valeurs: number[] = [];
  const parcourir = (objet: object) => {
    for (const v of Object.values(objet)) {
      if (typeof v === "number") valeurs.push(v);
      else if (v && typeof v === "object") parcourir(v);
    }
  };
  parcourir(calculerFinance(abime));
  assert.ok(valeurs.length > 10);
  for (const v of valeurs) assert.ok(Number.isFinite(v), `valeur non finie : ${v}`);
});

test("le calcul est pur : mêmes entrées, mêmes sorties, entrées intactes", () => {
  const entree = foyerType();
  const copie = structuredClone(entree);
  assert.deepEqual(calculerFinance(entree), calculerFinance(entree));
  assert.deepEqual(entree, copie);
});
