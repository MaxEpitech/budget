// Le client possède sa propre copie des formules (client/src/finance.js) pour
// afficher un tableau d'amortissement ou une projection sans aller-retour
// réseau. Une copie diverge tôt ou tard : ce test compare les deux sur une
// grille de valeurs plutôt que ligne à ligne, parce que c'est le résultat qui
// doit coïncider, pas la mise en forme.
//
// Il ne remplace pas finance.test.js : celui-là dit ce que les formules
// doivent valoir, celui-ci dit seulement que les deux exemplaires s'accordent.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as serveur from "../src/finance.js";
import * as client from "../../client/src/finance.js";

// Chaque entrée : le nom de la fonction, et les jeux d'arguments à comparer.
const CAS = {
  mensualite: [
    [14000, 3.9, 60], [105000, 3.5, 300], [10000, 0, 24], [0, 3, 12], [14000, 3.9, 0],
  ],
  capitalRestant: [
    [14000, 3.9, 60, 0], [14000, 3.9, 60, 1], [14000, 3.9, 60, 59], [14000, 3.9, 60, 60],
    [105000, 3.5, 300, 26], [10000, 0, 24, 12], [14000, 3.9, 60, -3], [14000, 3.9, 60, 900],
  ],
  coutTotal: [
    [14000, 3.9, 60], [105000, 3.5, 300], [10000, 0, 24], [0, 3.9, 60], [14000, 3.9, 0],
  ],
  interetsPayes: [
    [14000, 3.9, 60, 0], [14000, 3.9, 60, 30], [14000, 3.9, 60, 60], [14000, 3.9, 60, 900],
    [105000, 3.5, 300, 26], [12000, 0, 24, 12], [14000, 3.9, 60, -5],
  ],
  projeter: [
    [8400, 150, 2.4, 0], [8400, 150, 2.4, 120], [1000, 100, 0, 60], [0, 200, 5, 240],
  ],
  projeterPlafonne: [
    [8400, 150, 2.4, 120, null], [8400, 150, 2.4, 120, 22950], [22950, 150, 2.4, 60, 22950],
    [1000, 100, 0, 60, 1500], [0, 0, 3, 12, 1000],
  ],
  verseAvecPlafond: [
    [8400, 150, 2.4, 120, null], [8400, 150, 2.4, 120, 22950], [1000, 100, 0, 60, 1500],
  ],
  cotisationAssurance: [
    [105000, 99083, 0.34, "initial"], [105000, 99083, 0.34, "restant"],
    [105000, 99083, 0, "initial"], [105000, -50, 0.34, "restant"],
  ],
  assurancePayee: [
    [105000, 3.5, 300, 0.34, "initial", 26], [105000, 3.5, 300, 0.34, "restant", 26],
    [105000, 3.5, 300, 0.34, "restant", 300], [105000, 3.5, 300, 0, "initial", 26],
    [105000, 3.5, 300, 0.34, "initial", 900], [105000, 3.5, 300, 0.34, "initial", -5],
  ],
  echeanceTotale: [
    [105000, 3.5, 300, 0.34, "initial", 26], [105000, 3.5, 300, 0.34, "restant", 26],
    [105000, 3.5, 300, 0, "initial", 0],
  ],
  indemniteAnticipee: [
    [5000, 99083, 3.5], [80000, 99083, 12], [5000, 99083, 0], [-5000, 99083, 3.5],
  ],
  moisAvantPlafond: [
    [8400, 150, 2.4, 22950], [1000, 100, 0, 1500], [23000, 150, 2.4, 22950],
    [1000, 0, 0, 5000], [1000, 100, 2, null], [1000, 0, 12, 1010],
  ],
  quotePart: [
    [3050, 5030, 2, "prorata"], [3050, 5030, 2, "moitie"], [0, 0, 2, "prorata"],
  ],
  versementRequis: [
    [6000, 1850, 14], [1000, 0, 0], [1000, 0, -5], [1000, 1200, 6],
  ],
  resteAVivre: [
    [{ revenus: 5030, depenses: 1092, mensualitesCredits: 526, versementsProjets: 250, versementsPlacements: 150 }],
    [{ revenus: 1000, depenses: 1500, mensualitesCredits: 0, versementsProjets: 0, versementsPlacements: 0 }],
  ],
};

// Fonctions dont le résultat n'est pas un nombre : comparées par égalité stricte.
const CAS_NON_NUMERIQUES = {
  echeanceCeMois: [
    [{ debut: null, fin: null, periodicite: "mensuel" }, "2026-08"],
    [{ debut: "2026-02", fin: null, periodicite: "trimestriel" }, "2026-08"],
    [{ debut: "2026-02", fin: null, periodicite: "trimestriel" }, "2026-09"],
    [{ debut: "2026-09", fin: null, periodicite: "mensuel" }, "2026-08"],
    [{ debut: "2026-01", fin: "2026-06", periodicite: "mensuel" }, "2026-08"],
    [{ debut: "2026-01", fin: "2026-08", periodicite: "mensuel" }, "2026-08"],
    [{ debut: "2025-08", fin: null, periodicite: "annuel" }, "2026-08"],
  ],
  rembourserParAnticipation: [
    [{ capital: 105000, tauxAnnuel: 3.5, dureeMois: 300, echeancesPayees: 26, versement: 5000 }],
    [{ capital: 105000, tauxAnnuel: 3.5, dureeMois: 300, echeancesPayees: 26, versement: 40000 }],
    [{ capital: 12000, tauxAnnuel: 0, dureeMois: 24, echeancesPayees: 0, versement: 3000 }],
    [{ capital: 105000, tauxAnnuel: 3.5, dureeMois: 300, echeancesPayees: 26, versement: 0 }],
    [{ capital: 105000, tauxAnnuel: 3.5, dureeMois: 300, echeancesPayees: 300, versement: 5000 }],
  ],
  lignesDuMois: [
    [[
      { recurrent: true, periodicite: "mensuel", debut: null, fin: null, montant: 980 },
      { recurrent: true, periodicite: "trimestriel", debut: "2026-02", fin: null, montant: 320 },
      { recurrent: false, mois: "2026-08", montant: 124 },
      { recurrent: false, mois: "2026-07", montant: 68 },
    ], "2026-08"],
  ],
  repartirParMembre: [
    [{
      membres: [{ id: "a", nom: "Maxime", revenu: 3050 }, { id: "b", nom: "Estelle", revenu: 1980 }],
      transactions: [
        { type: "depense", pour: "foyer", recurrent: true, periodicite: "mensuel", debut: null, fin: null, montant: 980 },
        { type: "depense", pour: "a", recurrent: false, mois: "2026-08", montant: 26 },
        { type: "revenu", pour: "a", recurrent: false, mois: "2026-08", montant: 300 },
      ],
      credits: [
        { capital: 105000, taux: 3.5, duree: 300, debut: "2024-06", assuranceTaux: 0.34, assuranceBase: "initial", pour: "foyer" },
        { capital: 14000, taux: 3.9, duree: 60, debut: "2025-03", assuranceTaux: 0, assuranceBase: "initial", pour: "b" },
      ],
      projets: [{ versement: 250 }],
      placements: [{ versement: 150, pour: "foyer" }, { versement: 80, pour: "a" }],
      repartition: "prorata",
    }, "2026-08"],
    [{
      membres: [{ id: "a", nom: "Maxime", revenu: 3050 }, { id: "b", nom: "Estelle", revenu: 1980 }],
      transactions: [],
      credits: [{ capital: 14000, taux: 3.9, duree: 60, debut: "2025-03", pour: "b" }],
      projets: [],
      placements: [],
      repartition: "moitie",
    }, "2026-08"],
    [{ membres: [], transactions: [], credits: [], projets: [], placements: [] }, "2026-08"],
    // Un salaire réel remplace la référence de sa personne, et pèse sur la quote-part.
    [{
      membres: [{ id: "a", nom: "Maxime", revenu: 3050 }, { id: "b", nom: "Estelle", revenu: 1980 }],
      transactions: [
        { type: "depense", pour: "foyer", recurrent: true, periodicite: "mensuel", debut: null, fin: null, montant: 980 },
        { type: "revenu", pour: "a", categorie: "Salaire", recurrent: false, mois: "2026-08", montant: 2800 },
        { type: "revenu", pour: "a", categorie: "Autre", recurrent: false, mois: "2026-08", montant: 300 },
        { type: "revenu", pour: "foyer", categorie: "Salaire", recurrent: false, mois: "2026-08", montant: 100 },
      ],
      credits: [], projets: [], placements: [], repartition: "prorata",
    }, "2026-08"],
  ],
  revenusDuMois: [
    [[{ id: "a", revenu: 3050 }, { id: "b", revenu: 1980 }], []],
    [[{ id: "a", revenu: 3050 }, { id: "b", revenu: 1980 }], [
      { type: "revenu", pour: "a", categorie: "Salaire", montant: 1400 },
      { type: "revenu", pour: "a", categorie: "Salaire", montant: 1500 },
      { type: "revenu", pour: "b", categorie: "Autre", montant: 200 },
      { type: "depense", pour: "b", categorie: "Salaire", montant: 50 },
    ]],
  ],
  totauxDuMois: [
    [{
      membres: [{ id: 1, revenu: 3050 }, { id: 2, revenu: 1980 }],
      transactions: [
        { type: "depense", pour: "foyer", recurrent: true, periodicite: "mensuel", debut: null, fin: null, montant: 980 },
        { type: "revenu", pour: 1, recurrent: false, mois: "2026-08", montant: 300 },
      ],
      credits: [
        { capital: 105000, taux: 3.5, duree: 300, debut: "2024-06", assuranceTaux: 0.34, assuranceBase: "initial" },
        { capital: 12000, taux: 2, duree: 48, debut: "2020-01", assuranceTaux: 0.2, assuranceBase: "restant" },
      ],
      projets: [{ versement: 250 }],
      placements: [{ versement: 150 }],
    }, "2026-08"],
    [{
      membres: [{ id: 1, revenu: 3050 }, { id: 2, revenu: 1980 }],
      transactions: [
        { type: "revenu", pour: 1, categorie: "Salaire", recurrent: false, mois: "2026-08", montant: 2900 },
        { type: "revenu", pour: "foyer", categorie: "Salaire", recurrent: false, mois: "2026-08", montant: 120 },
      ],
    }, "2026-08"],
  ],
};

const TOLERANCE = 1e-9;

for (const [nom, jeux] of Object.entries(CAS)) {
  test(`formules client et serveur d'accord : ${nom}`, () => {
    assert.equal(typeof serveur[nom], "function", `${nom} absente du serveur`);
    assert.equal(typeof client[nom], "function", `${nom} absente du client`);
    for (const args of jeux) {
      const a = serveur[nom](...args);
      const b = client[nom](...args);
      if (a === null || b === null) {
        assert.equal(b, a, `${nom}(${args.join(", ")})`);
      } else {
        assert.ok(
          Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a)),
          `${nom}(${args.join(", ")}) : serveur ${a}, client ${b}`
        );
      }
    }
  });
}

for (const [nom, jeux] of Object.entries(CAS_NON_NUMERIQUES)) {
  test(`formules client et serveur d'accord : ${nom}`, () => {
    for (const args of jeux) {
      assert.deepEqual(
        client[nom](...structuredClone(args)),
        serveur[nom](...structuredClone(args)),
        `${nom}(${JSON.stringify(args)})`
      );
    }
  });
}

// Une fonction ajoutée au serveur et oubliée côté client ne serait détectée par
// aucun des cas ci-dessus : ils ne portent que sur ce qui y figure déjà.
test("toute formule partagée est couverte par la comparaison", () => {
  const partagees = Object.keys(serveur).filter(
    (nom) => typeof serveur[nom] === "function" && typeof client[nom] === "function"
  );
  const manquantes = partagees.filter((nom) => !(nom in CAS) && !(nom in CAS_NON_NUMERIQUES));
  assert.deepEqual(manquantes, [], `formules partagées non comparées : ${manquantes.join(", ")}`);
});

// Et une fonction présente des deux côtés mais sous un autre nom passerait
// inaperçue : on vérifie que le client n'a pas pris de retard.
test("le client expose toutes les formules de calcul du serveur", () => {
  const attendues = Object.keys(serveur).filter((nom) => typeof serveur[nom] === "function");
  const absentes = attendues.filter((nom) => typeof client[nom] !== "function");
  assert.deepEqual(absentes, [], `formules absentes du client : ${absentes.join(", ")}`);
});
