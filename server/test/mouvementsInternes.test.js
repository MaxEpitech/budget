// Mouvements internes : un virement vers l'épargne, un versement sur un projet,
// une échéance de prêt ne sont pas des dépenses. Venus du flux ou d'un relevé,
// ils alimentent l'écran concerné — et lui seul.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { suggererAffectations } from "../src/banque/affectations.js";
import { echeanceTotale } from "../src/finance.js";

/* ─── Reconnaissance dans un relevé ─── */

const ligne = (libelle, euros, date = "2026-09-05", extra = {}) => ({
  cle: "x", date, libelle, type: euros < 0 ? "depense" : "revenu", montant: Math.round(Math.abs(euros) * 100), ...extra,
});

const VOITURE = { id: "c1", libelle: "Voiture", capital: 14000, taux: 3.9, duree: 60, debut: "2025-04", assuranceTaux: 0.3, assuranceBase: "initial" };
// L'échéance de septembre 2026 : la 18e, assurance comprise.
const ECHEANCE = Math.round(echeanceTotale(14000, 3.9, 60, 0.3, "initial", 17) * 100) / 100;

test("un prélèvement égal à l'échéance d'un crédit en cours est reconnu, à un euro près", () => {
  const [exact, proche, autre, avant] = suggererAffectations(
    [ligne("PRLV SEPA FINANCO", -ECHEANCE), ligne("PRLV PRET", -(ECHEANCE + 0.8)), ligne("PRLV EDF", -(ECHEANCE + 5)), ligne("PRLV", -ECHEANCE, "2025-02-05")],
    { credits: [VOITURE] },
  );
  assert.deepEqual(exact.affectation, { nature: "credit", id: "c1" });
  assert.deepEqual(proche.affectation, { nature: "credit", id: "c1" });
  assert.equal(autre.affectation, undefined);
  assert.equal(avant.affectation, undefined, "un crédit pas encore commencé n'a pas d'échéance");
});

test("un virement qui nomme un support ou un projet est reconnu, en mots entiers", () => {
  const foyer = {
    placements: [{ id: "p1", libelle: "Livret A" }, { id: "p2", libelle: "PEA" }],
    projets: [{ id: "j1", libelle: "Voyage Japon" }],
  };
  const lignes = suggererAffectations(
    [
      ligne("VIR SEPA VERS LIVRET A", -150),
      ligne("VIR DE LIVRET A", 200),
      ligne("VERSEMENT PEA MENSUEL", -100),
      ligne("PEAGE AUTOROUTE A6", -12.4),
      ligne("VIR VOYAGE JAPON", -250),
      ligne("REMBOURSEMENT VOYAGE JAPON", 80),
      ligne("VIR LIVRET A SALAIRE", 2450, "2026-09-28", { salaire: true }),
    ],
    foyer,
  );
  assert.deepEqual(lignes.map((l) => l.affectation ?? null), [
    { nature: "epargne", id: "p1" },
    { nature: "epargne", id: "p1" },
    { nature: "epargne", id: "p2" },
    null,
    { nature: "projet", id: "j1" },
    null,
    null,
  ]);
});

/* ─── Parcours ─── */

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

const virgule = (euros) => euros.toFixed(2).replace(".", ",");

/** Un support, un projet et un crédit, et le relevé qui les fait bouger. */
async function preparer(client) {
  const livret = (await client.appel("/placements", "POST", { libelle: "Livret A", valeur: 1000, versement: 150, rendement: 3, plafond: 22950 })).corps;
  const japon = (await client.appel("/projets", "POST", { libelle: "Voyage Japon", objectif: 6000, echeance: "2027-12", versement: 250 })).corps;
  const voiture = (await client.appel("/credits", "POST", { ...VOITURE, id: undefined })).corps;
  const releve = [
    "Date;Libellé;Montant",
    "05/09/2026;VIR SEPA VERS LIVRET A;-150,00",
    `08/09/2026;PRLV SEPA ECHEANCE PRET;-${virgule(ECHEANCE)}`,
    "12/09/2026;VIR DE LIVRET A;200,00",
    "15/09/2026;VIR VOYAGE JAPON;-250,00",
    "17/09/2026;CB CARREFOUR MARKET;-62,40",
  ].join("\n");
  return { livret, japon, voiture, releve };
}

const aImporter = (apercu) =>
  apercu.operations
    .filter((o) => !o.dejaImportee)
    .map(({ cle, date, type, libelle, montant, categorie, affectation }) => ({ cle, date, type, libelle, montant, categorie, ...(affectation ? { affectation } : {}) }));

testIntegration("un relevé range virements d'épargne, versements de projet et échéances dans leur écran, sans en faire des dépenses", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { livret, japon, voiture, releve } = await preparer(client);

    const apercu = (await client.appel("/banque/releve", "POST", { contenu: releve })).corps;
    const proposee = (libelle) => apercu.operations.find((o) => o.libelle === libelle).affectation ?? null;
    assert.deepEqual(proposee("VIR SEPA VERS LIVRET A"), { nature: "epargne", id: livret.id });
    assert.deepEqual(proposee("VIR DE LIVRET A"), { nature: "epargne", id: livret.id });
    assert.deepEqual(proposee("PRLV SEPA ECHEANCE PRET"), { nature: "credit", id: voiture.id });
    assert.deepEqual(proposee("VIR VOYAGE JAPON"), { nature: "projet", id: japon.id });
    assert.equal(proposee("CB CARREFOUR MARKET"), null);

    const importe = await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) });
    assert.equal(importe.code, 201);
    assert.deepEqual([importe.corps.ajoutees, importe.corps.internes, importe.corps.dejaPresentes], [5, 4, 0]);

    const etat = (await client.appel("/etat?mois=2026-09")).corps;
    assert.deepEqual(etat.transactions.map((t) => t.libelle), ["CB CARREFOUR MARKET"], "seule la dépense entre dans le flux");
    const support = etat.placements.find((p) => p.id === livret.id);
    assert.equal(support.valeur, 950, "1 000 + 150 versés − 200 retirés");
    assert.deepEqual(
      support.mouvements.map((m) => [m.type, m.montant, m.libelle, m.date.slice(0, 10), m.importe]),
      [["retrait", 200, "VIR DE LIVRET A", "2026-09-12", true], ["versement", 150, "VIR SEPA VERS LIVRET A", "2026-09-05", true]],
    );
    assert.deepEqual(support.mouvements.map((m) => m.valeurApres), [950, 1150], "la valeur suit les mouvements dans l'ordre des dates");
    const enveloppe = etat.projets.find((p) => p.id === japon.id);
    assert.equal(enveloppe.epargne, 250);
    assert.equal(enveloppe.versements[0].date.slice(0, 10), "2026-09-15");
    const pret = etat.credits.find((c) => c.id === voiture.id);
    assert.deepEqual(pret.paiements.map((p) => [p.montant, p.date.slice(0, 10)]), [[ECHEANCE, "2026-09-08"]]);

    // Réimporter le même relevé : tout est reconnu, quelle que soit sa forme.
    const second = (await client.appel("/banque/releve", "POST", { contenu: releve })).corps;
    assert.equal(second.operations.filter((o) => o.dejaImportee).length, 5);
    const rejoue = await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) });
    assert.deepEqual([rejoue.corps.ajoutees, rejoue.corps.dejaPresentes], [0, 5]);

    // Annuler l'import défait tout, et rend au support sa valeur d'avant.
    const annule = await client.appel(`/transactions/import/${importe.corps.lot}`, "DELETE");
    assert.deepEqual(annule.corps, { retirees: 5 });
    const apres = (await client.appel("/etat?mois=2026-09")).corps;
    assert.equal(apres.transactions.length, 0);
    assert.equal(apres.placements[0].valeur, 1000);
    assert.equal(apres.placements[0].mouvements.length, 0);
    assert.equal(apres.projets[0].versements.length, 0);
    assert.equal(apres.credits[0].paiements.length, 0);
  });
});

testIntegration("un mouvement interne impossible est refusé, et rien n'est écrit", async () => {
  await avecFoyer(async (mien) => {
    const client = await clientConnecte(serveur.base, mien);
    const { livret, japon, releve } = await preparer(client);
    const operations = aImporter((await client.appel("/banque/releve", "POST", { contenu: releve })).corps);
    const avec = (libelle, affectation) => operations.map((o) => (o.libelle === libelle ? { ...o, affectation } : o));

    // Une entrée d'argent ne remplit pas un projet.
    const entree = await client.appel("/transactions/import", "POST", { operations: avec("VIR DE LIVRET A", { nature: "projet", id: japon.id }) });
    assert.equal(entree.code, 400);
    assert.match(entree.corps.erreur, /entrée d'argent/);

    // Un retrait plus grand que ce que le support contient.
    await client.appel(`/placements/${livret.id}`, "PUT", { valeur: 10 });
    const retrait = await client.appel("/transactions/import", "POST", { operations });
    assert.equal(retrait.code, 400);
    assert.match(retrait.corps.erreur, /VIR DE LIVRET A.*Livret A/);

    // Un versement qui ferait passer le plafond.
    await client.appel(`/placements/${livret.id}`, "PUT", { valeur: 22900 });
    const plafond = await client.appel("/transactions/import", "POST", { operations: avec("VIR DE LIVRET A", undefined) });
    assert.equal(plafond.code, 400);
    assert.match(plafond.corps.erreur, /plafond/);

    // Une destination d'un autre foyer se comporte comme une destination inexistante.
    await avecFoyer(async (voisin) => {
      const sien = await voisin.prisma.placement.create({
        data: { libelle: "Le sien", valeur: 0, versementMensuel: 0, rendement: 0, foyerId: voisin.foyer.id },
      });
      const ailleurs = await client.appel("/transactions/import", "POST", { operations: avec("VIR SEPA VERS LIVRET A", { nature: "epargne", id: sien.id }) });
      assert.equal(ailleurs.code, 400);
      assert.equal(await voisin.prisma.mouvementPlacement.count({ where: { placementId: sien.id } }), 0);
    });

    // Aucun de ces refus n'a laissé de trace, même partielle.
    assert.equal(await mien.prisma.transaction.count({ where: { foyerId: mien.foyer.id } }), 0);
    assert.equal(await mien.prisma.mouvementPlacement.count({ where: { placementId: livret.id } }), 0);
    assert.equal(await mien.prisma.versement.count({ where: { projetId: japon.id } }), 0);
    assert.equal((await mien.prisma.placement.findUnique({ where: { id: livret.id } })).valeur, 2_290_000);
  });
});

testIntegration("mouvements saisis à la main : à leur date, avec leur libellé, et dans leur foyer", async () => {
  await avecFoyer(async (mien) => {
    const client = await clientConnecte(serveur.base, mien);
    const { livret, japon, voiture } = await preparer(client);

    const paye = await client.appel(`/credits/${voiture.id}/paiements`, "POST", { montant: ECHEANCE, date: "2026-09-08", libelle: "Échéance de septembre" });
    assert.equal(paye.code, 201);
    assert.deepEqual([paye.corps.montant, paye.corps.libelle, paye.corps.importe], [ECHEANCE, "Échéance de septembre", false]);
    const verse = await client.appel(`/projets/${japon.id}/versements`, "POST", { montant: 100, date: "2026-08-03" });
    assert.equal(verse.corps.date.slice(0, 10), "2026-08-03");
    const epargne = await client.appel(`/placements/${livret.id}/mouvements`, "POST", { type: "versement", montant: 50, date: "2026-09-01", libelle: "Virement" });
    assert.deepEqual([epargne.corps.date.slice(0, 10), epargne.corps.libelle], ["2026-09-01", "Virement"]);
    assert.equal((await client.appel(`/credits/${voiture.id}/paiements`, "POST", { montant: 10, date: "01/09/2026" })).code, 400);

    // Rien de tout cela n'est une ligne du flux.
    const etat = (await client.appel("/etat?mois=2026-09")).corps;
    assert.equal(etat.transactions.length, 0);
    assert.equal(etat.credits[0].paiements.length, 1);

    // Un autre foyer ne voit ni ne supprime ces paiements.
    await avecFoyer(async (voisin) => {
      const sonClient = await clientConnecte(serveur.base, voisin);
      assert.equal((await sonClient.appel(`/credits/${voiture.id}/paiements/${paye.corps.id}`, "DELETE")).code, 404);
      assert.equal((await sonClient.appel(`/credits/${voiture.id}/paiements`, "POST", { montant: 1 })).code, 404);
    });
    assert.equal((await client.appel(`/credits/${voiture.id}/paiements/${paye.corps.id}`, "DELETE")).code, 204);
    assert.equal((await client.appel("/etat?mois=2026-09")).corps.credits[0].paiements.length, 0);
  });
});
