// Récurrences datées et périodiques, vues depuis l'API.
//
// La règle elle-même est éprouvée dans finance.test.js ; ici on vérifie qu'elle
// est bien appliquée au mois demandé, et que le reste à vivre en tient compte —
// c'est le chiffre que l'application met en avant.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";

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

const depense = (libelle, montant, extra) => ({
  type: "depense", libelle, montant, categorie: "Autre", recurrent: true, ...extra,
});

const libelles = (etat) => etat.transactions.map((t) => t.libelle).sort();

testIntegration("un rythme trimestriel ne tombe qu'un mois sur trois", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", depense("Charges copro", 320, { periodicite: "trimestriel", debut: "2026-02" }));

    for (const mois of ["2026-02", "2026-05", "2026-08"]) {
      assert.deepEqual(libelles((await client.appel(`/etat?mois=${mois}`)).corps), ["Charges copro"], `attendu en ${mois}`);
    }
    for (const mois of ["2026-03", "2026-04", "2026-06"]) {
      assert.deepEqual(libelles((await client.appel(`/etat?mois=${mois}`)).corps), [], `pas attendu en ${mois}`);
    }
  });
});

testIntegration("le montant n'est pas lissé : il pèse sur le mois de l'échéance", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", depense("Assurance", 240, { periodicite: "annuel", debut: "2026-03" }));

    const mars = (await client.appel("/etat?mois=2026-03")).corps;
    const avril = (await client.appel("/etat?mois=2026-04")).corps;

    // Lisser à 20 €/mois afficherait un reste à vivre que personne n'a jamais eu
    // sur son compte, ni en mars ni en avril.
    assert.equal(mars.transactions[0].montant, 240);
    assert.equal(avril.transactions.length, 0);
  });
});

testIntegration("résilier une ligne ne l'efface pas des mois passés", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", depense("Abonnement", 14, { fin: "2026-06" }));

    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-05")).corps), ["Abonnement"]);
    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-06")).corps), ["Abonnement"], "la fin est incluse");
    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-07")).corps), []);
  });
});

testIntegration("une ligne n'apparaît pas avant son début", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", depense("Nouveau loyer", 980, { debut: "2026-06" }));

    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-05")).corps), []);
    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-06")).corps), ["Nouveau loyer"]);
  });
});

testIntegration("le reste à vivre suit les échéances du mois", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/membres", "POST", { nom: "Alex", revenu: 3000 });
    await client.appel("/transactions", "POST", depense("Loyer", 1000, { periodicite: "mensuel" }));
    await client.appel("/transactions", "POST", depense("Impôts", 600, { periodicite: "annuel", debut: "2026-09" }));

    const aout = (await client.appel("/etat?mois=2026-08")).corps;
    const septembre = (await client.appel("/etat?mois=2026-09")).corps;

    const depenses = (e) => e.transactions.reduce((s, t) => s + t.montant, 0);
    assert.equal(depenses(aout), 1000);
    assert.equal(depenses(septembre), 1600, "le mois de l'échéance annuelle pèse plus lourd");
  });
});

testIntegration("un rythme non mensuel sans ancrage est refusé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    // Sans mois de départ, on ne saurait pas quand tombe la première échéance.
    const r = await client.appel("/transactions", "POST", depense("Sans ancrage", 100, { periodicite: "annuel" }));
    assert.equal(r.code, 400);
    assert.match(r.corps.erreur, /premier prélèvement/i);
  });
});

testIntegration("une fin antérieure au début est refusée", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/transactions", "POST", depense("À l'envers", 100, { debut: "2026-06", fin: "2026-03" }));
    assert.equal(r.code, 400);
    assert.match(r.corps.erreur, /ne peut pas précéder/i);
  });
});

testIntegration("une ligne ponctuelle ignore rythme et période", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Restaurant", montant: 45, categorie: "Loisirs",
      recurrent: false, mois: "2026-08", periodicite: "annuel", debut: "2026-01", fin: "2026-12",
    });
    assert.equal(r.code, 201);
    // Elle n'arrive qu'une fois : lui prêter un rythme n'aurait aucun sens.
    assert.equal(r.corps.periodicite, "mensuel");
    assert.equal(r.corps.debut, null);
    assert.equal(r.corps.fin, null);
    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-08")).corps), ["Restaurant"]);
    assert.deepEqual(libelles((await client.appel("/etat?mois=2026-09")).corps), []);
  });
});
