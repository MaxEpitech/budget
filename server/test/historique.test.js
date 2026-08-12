// Historique du budget mois par mois.
//
// Le risque propre à cet écran n'est pas de se tromper de calcul : c'est de ne
// pas raconter la même histoire que le mois affiché. Les deux partagent donc la
// même fonction, et ces tests vérifient qu'ils tombent bien d'accord.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { totauxDuMois } from "../src/finance.js";

let serveur = null;
let rendreLaParole = null;

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

/* ─── Les totaux, en fonction pure ───────────────────────────────────────── */

test("les totaux d'un mois : revenus, sorties, et ce qui reste", () => {
  const t = totauxDuMois(
    {
      membres: [{ revenu: 2450 }, { revenu: 1980 }],
      transactions: [
        { type: "depense", montant: 980, recurrent: true },
        { type: "revenu", montant: 300, recurrent: false, mois: "2026-08" },
      ],
      credits: [{ capital: 14000, taux: 3.9, duree: 60, debut: "2025-02" }],
      projets: [{ versement: 250 }],
      placements: [{ versement: 150 }],
    },
    "2026-08",
  );

  assert.equal(t.salaires, 4430);
  assert.equal(t.revenus, 4730, "les revenus ponctuels du mois s'ajoutent aux salaires");
  assert.equal(t.depenses, 980);
  assert.ok(Math.abs(t.credits - 257.2) < 0.01);
  assert.equal(t.projets, 250);
  assert.equal(t.placements, 150);
  assert.ok(Math.abs(t.reste - (4730 - 980 - 257.2 - 250 - 150)) < 0.01);
});

test("un crédit soldé ne pèse plus sur les mois suivants", () => {
  const donnees = { credits: [{ capital: 14000, taux: 3.9, duree: 60, debut: "2020-01" }] };
  assert.ok(totauxDuMois(donnees, "2024-12").credits > 0);
  assert.equal(totauxDuMois(donnees, "2025-01").credits, 0, "la 60e échéance était en décembre 2024");
});

test("une ligne ponctuelle ne compte que dans son mois", () => {
  const donnees = { transactions: [{ type: "depense", montant: 45, recurrent: false, mois: "2026-08" }] };
  assert.equal(totauxDuMois(donnees, "2026-08").depenses, 45);
  assert.equal(totauxDuMois(donnees, "2026-09").depenses, 0);
});

test("les échéances non mensuelles ne sont pas lissées", () => {
  const donnees = {
    transactions: [{ type: "depense", montant: 240, recurrent: true, periodicite: "annuel", debut: "2026-03" }],
  };
  assert.equal(totauxDuMois(donnees, "2026-03").depenses, 240);
  assert.equal(totauxDuMois(donnees, "2026-04").depenses, 0, "lisser à 20 €/mois montrerait un solde jamais eu");
});

test("un foyer vide donne des totaux nuls, pas des erreurs", () => {
  const t = totauxDuMois({}, "2026-08");
  assert.deepEqual(
    { revenus: t.revenus, depenses: t.depenses, credits: t.credits, reste: t.reste },
    { revenus: 0, depenses: 0, credits: 0, reste: 0 },
  );
});

/* ─── L'API ──────────────────────────────────────────────────────────────── */

testIntegration("l'historique rend autant de mois que demandé, dans l'ordre", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/historique?jusqu=2026-08&mois=6");

    assert.equal(r.code, 200);
    assert.equal(r.corps.serie.length, 6);
    assert.deepEqual(
      r.corps.serie.map((m) => m.mois),
      ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"],
      "du plus ancien au plus récent",
    );
  });
});

testIntegration("l'historique et le mois affiché racontent la même chose", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/membres", "POST", { nom: "Alex", revenu: 3050 });
    await client.appel("/transactions", "POST", { type: "depense", libelle: "Loyer", montant: 980, categorie: "Logement", recurrent: true });
    await client.appel("/transactions", "POST", { type: "depense", libelle: "Charges", montant: 320, categorie: "Logement", recurrent: true, periodicite: "trimestriel", debut: "2026-02" });
    await client.appel("/credits", "POST", { libelle: "Prêt", capital: 14000, taux: 3.9, duree: 60, debut: "2025-02" });
    await client.appel("/placements", "POST", { libelle: "Livret", valeur: 8400, versement: 150, rendement: 2.4 });

    const etat = (await client.appel("/etat?mois=2026-08")).corps;
    const serie = (await client.appel("/historique?jusqu=2026-08&mois=1")).corps.serie[0];

    // Les mêmes données recalculées par le même code : tout écart signalerait
    // que l'un des deux écrans a divergé.
    const attendu = totauxDuMois(
      { membres: etat.membres, transactions: etat.transactions, credits: etat.credits, projets: etat.projets, placements: etat.placements },
      "2026-08",
    );
    for (const cle of ["revenus", "depenses", "credits", "projets", "placements", "reste"]) {
      assert.ok(Math.abs(serie[cle] - attendu[cle]) < 0.01, `${cle} : ${serie[cle]} ≠ ${attendu[cle]}`);
    }
  });
});

testIntegration("les échéances trimestrielles ressortent dans l'historique", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", { type: "depense", libelle: "Charges", montant: 320, categorie: "Logement", recurrent: true, periodicite: "trimestriel", debut: "2026-02" });

    const serie = (await client.appel("/historique?jusqu=2026-08&mois=7")).corps.serie;
    const parMois = Object.fromEntries(serie.map((m) => [m.mois, m.depenses]));

    assert.equal(parMois["2026-02"], 320);
    assert.equal(parMois["2026-05"], 320);
    assert.equal(parMois["2026-08"], 320);
    assert.equal(parMois["2026-03"], 0);
    assert.equal(parMois["2026-06"], 0);
  });
});

testIntegration("l'historique est borné et validé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    assert.equal((await client.appel("/historique?jusqu=2026-13")).code, 400);
    assert.equal((await client.appel("/historique?mois=0")).code, 400);
    // Une demande sans borne ferait calculer des siècles pour rien.
    assert.equal((await client.appel("/historique?mois=1000")).code, 400);
    assert.equal((await client.appel("/historique?mois=abc")).code, 400);
  });
});

testIntegration("l'historique s'arrête aux frontières du foyer", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const prisma = (await import("./aide/harnais.js")).chargerPrisma;
      const client = await clientConnecte(serveur.base, mien);
      const base = await prisma();
      await base.membre.create({ data: { nom: "Voisin", revenuMensuel: 500000, foyerId: voisin.foyer.id } });

      const serie = (await client.appel("/historique?jusqu=2026-08&mois=1")).corps.serie[0];
      assert.equal(serie.revenus, 0, "le revenu du voisin ne doit pas apparaître");
    });
  });
});
