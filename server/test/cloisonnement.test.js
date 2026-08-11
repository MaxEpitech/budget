// Cloisonnement entre foyers.
//
// C'est la garantie centrale de l'application : un compte ne doit jamais rien
// apprendre ni rien toucher d'un autre foyer. Elle repose sur une discipline
// tenue à la main dans chaque routeur — filtrer en lecture, inclure le foyer
// dans la condition d'écriture — et rien n'empêchait jusqu'ici de l'oublier.
//
// Ces tests montent deux foyers : celui d'où l'on agit, et un voisin qui doit
// rester invisible et intact quoi qu'il arrive.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  creerFoyerJetable,
  clientConnecte,
  chargerPrisma,
  reinitialiserCadenceEssais,
} from "./aide/harnais.js";

let serveur = null;

before(async () => {
  if (!baseDEssaiDisponible) return;
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
});

/** Deux foyers indépendants, tous deux supprimés quoi qu'il advienne. */
async function avecDeuxFoyers(scenario) {
  const mien = await creerFoyerJetable();
  try {
    const voisin = await creerFoyerJetable();
    try {
      return await scenario(mien, voisin);
    } finally {
      await voisin.nettoyer();
    }
  } finally {
    await mien.nettoyer();
  }
}

/**
 * Remplit un foyer directement en base : ce que le voisin possède ne doit
 * jamais dépendre de l'API, sans quoi le test vérifierait l'API avec l'API.
 */
async function garnir(prisma, foyerId, marque) {
  const membre = await prisma.membre.create({
    data: { nom: `Membre ${marque}`, revenuMensuel: 200000, foyerId },
  });
  const transaction = await prisma.transaction.create({
    data: { type: "depense", libelle: `Dépense ${marque}`, montant: 4200, categorie: "Autre", recurrent: true, foyerId },
  });
  const credit = await prisma.credit.create({
    data: { libelle: `Crédit ${marque}`, capital: 500000, taux: 2, dureeMois: 24, moisDebut: "2026-01", foyerId },
  });
  const projet = await prisma.projet.create({
    data: { libelle: `Projet ${marque}`, objectif: 100000, echeance: "2027-06", versementMensuel: 5000, foyerId },
  });
  const placement = await prisma.placement.create({
    data: { libelle: `Placement ${marque}`, valeur: 300000, versementMensuel: 10000, rendement: 2, foyerId },
  });
  return { membre, transaction, credit, projet, placement };
}

const IDENTIFIANT_INEXISTANT = "cet-identifiant-n-existe-pas";

/* ─── Lectures ───────────────────────────────────────────────────────────── */

testIntegration("l'état du mois ne laisse rien filtrer du foyer voisin", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    await garnir(prisma, mien.foyer.id, "à moi");
    await garnir(prisma, voisin.foyer.id, "au voisin");

    const client = await clientConnecte(serveur.base, mien);
    const etat = (await client.appel("/etat")).corps;

    const tout = JSON.stringify(etat);
    assert.ok(!tout.includes("au voisin"), "des données du voisin apparaissent dans /etat");
    assert.equal(etat.membres.length, 1);
    assert.equal(etat.membres[0].nom, "Membre à moi");
    assert.equal(etat.credits.length, 1);
    assert.equal(etat.projets.length, 1);
    assert.equal(etat.placements.length, 1);
    assert.equal(etat.transactions.length, 1);
  });
});

testIntegration("les cinq listes ne montrent que le foyer connecté", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    await garnir(prisma, mien.foyer.id, "à moi");
    await garnir(prisma, voisin.foyer.id, "au voisin");

    const client = await clientConnecte(serveur.base, mien);
    for (const chemin of ["/membres", "/transactions", "/credits", "/projets", "/placements"]) {
      const liste = (await client.appel(chemin)).corps;
      assert.equal(liste.length, 1, `${chemin} devrait ne montrer qu'un élément`);
      assert.ok(
        !JSON.stringify(liste).includes("au voisin"),
        `${chemin} laisse filtrer le foyer voisin`,
      );
    }
  });
});

/* ─── Écritures croisées ─────────────────────────────────────────────────── */

testIntegration("modifier un objet du foyer voisin est impossible", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    const tentatives = [
      ["/membres", sien.membre.id, { nom: "Piraté" }],
      ["/transactions", sien.transaction.id, { type: "depense", libelle: "Piraté", montant: 1, categorie: "Autre", recurrent: true }],
      ["/credits", sien.credit.id, { libelle: "Piraté", capital: 1, taux: 1, duree: 1, debut: "2026-01" }],
      ["/projets", sien.projet.id, { libelle: "Piraté" }],
      ["/placements", sien.placement.id, { libelle: "Piraté" }],
    ];

    for (const [chemin, id, corps] of tentatives) {
      const r = await client.appel(`${chemin}/${id}`, "PUT", corps);
      assert.equal(r.code, 404, `${chemin} a laissé modifier un objet d'un autre foyer`);
    }
  });
});

testIntegration("supprimer un objet du foyer voisin est impossible", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    for (const [chemin, id] of [
      ["/membres", sien.membre.id],
      ["/transactions", sien.transaction.id],
      ["/credits", sien.credit.id],
      ["/projets", sien.projet.id],
      ["/placements", sien.placement.id],
    ]) {
      const r = await client.appel(`${chemin}/${id}`, "DELETE");
      assert.equal(r.code, 404, `${chemin} a laissé supprimer un objet d'un autre foyer`);
    }
  });
});

testIntegration("verser sur un projet du foyer voisin est impossible", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    const r = await client.appel(`/projets/${sien.projet.id}/versements`, "POST", { montant: 10 });
    assert.equal(r.code, 404);
    assert.equal(await prisma.versement.count({ where: { projetId: sien.projet.id } }), 0);
  });
});

testIntegration("rattacher une ligne à un membre du foyer voisin est refusé", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    const creation = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Fuite", montant: 10, categorie: "Autre",
      pour: sien.membre.id, recurrent: true,
    });
    assert.equal(creation.code, 400, "un membre d'un autre foyer ne doit pas être acceptable");

    // Et le même refus sur un projet, où « pour » désigne aussi un membre.
    const monProjet = await client.appel("/projets", "POST", {
      libelle: "Le mien", objectif: 1000, echeance: "2027-01", versement: 100,
    });
    const versement = await client.appel(`/projets/${monProjet.corps.id}/versements`, "POST", {
      montant: 10, pour: sien.membre.id,
    });
    assert.equal(versement.code, 400);
  });
});

/* ─── Discrétion ─────────────────────────────────────────────────────────── */

testIntegration("un identifiant du voisin se comporte comme un identifiant inexistant", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    // Si la réponse différait, il suffirait de comparer pour savoir qu'un objet
    // existe ailleurs — et une simple énumération dresserait la carte des
    // autres foyers.
    for (const [chemin, id] of [
      ["/membres", sien.membre.id],
      ["/credits", sien.credit.id],
      ["/projets", sien.projet.id],
      ["/placements", sien.placement.id],
    ]) {
      const etranger = await client.appel(`${chemin}/${id}`, "DELETE");
      const inexistant = await client.appel(`${chemin}/${IDENTIFIANT_INEXISTANT}`, "DELETE");
      assert.equal(etranger.code, inexistant.code, `${chemin} : codes différents`);
      assert.deepEqual(etranger.corps, inexistant.corps, `${chemin} : messages différents`);
    }
  });
});

/* ─── Intégrité du voisin ────────────────────────────────────────────────── */

testIntegration("le foyer voisin ressort intact de toutes ces tentatives", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const sien = await garnir(prisma, voisin.foyer.id, "au voisin");
    const client = await clientConnecte(serveur.base, mien);

    // Toutes les tentatives d'un coup, y compris le mode de répartition.
    await client.appel(`/membres/${sien.membre.id}`, "PUT", { nom: "Piraté" });
    await client.appel(`/membres/${sien.membre.id}`, "DELETE");
    await client.appel(`/projets/${sien.projet.id}`, "PUT", { libelle: "Piraté" });
    await client.appel(`/projets/${sien.projet.id}`, "DELETE");
    await client.appel(`/placements/${sien.placement.id}`, "DELETE");
    await client.appel(`/credits/${sien.credit.id}`, "DELETE");
    await client.appel(`/transactions/${sien.transaction.id}`, "DELETE");
    await client.appel("/foyer", "PUT", { repartition: "moitie" });

    const apres = await prisma.foyer.findUnique({
      where: { id: voisin.foyer.id },
      include: { _count: { select: { membres: true, transactions: true, credits: true, projets: true, placements: true } } },
    });
    assert.deepEqual(apres._count, { membres: 1, transactions: 1, credits: 1, projets: 1, placements: 1 });
    assert.equal(apres.repartition, "prorata", "le mode de répartition du voisin a changé");

    const membre = await prisma.membre.findUnique({ where: { id: sien.membre.id } });
    assert.equal(membre.nom, "Membre au voisin", "le membre du voisin a été renommé");
  });
});

/* ─── Rattachement des créations ─────────────────────────────────────────── */

testIntegration("tout ce qui est créé est rattaché au foyer connecté", async () => {
  await avecDeuxFoyers(async (mien) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, mien);

    const membre = await client.appel("/membres", "POST", { nom: "Alex", revenu: 2000 });
    const transaction = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Loyer", montant: 900, categorie: "Logement", recurrent: true,
    });
    const credit = await client.appel("/credits", "POST", {
      libelle: "Voiture", capital: 14000, taux: 3.9, duree: 60, debut: "2026-01",
    });
    const projet = await client.appel("/projets", "POST", {
      libelle: "Voyage", objectif: 6000, echeance: "2027-10", versement: 250,
    });
    const placement = await client.appel("/placements", "POST", {
      libelle: "Livret A", valeur: 8400, versement: 150, rendement: 2.4,
    });

    for (const r of [membre, transaction, credit, projet, placement]) assert.equal(r.code, 201);

    assert.equal((await prisma.membre.findUnique({ where: { id: membre.corps.id } })).foyerId, mien.foyer.id);
    assert.equal((await prisma.transaction.findUnique({ where: { id: transaction.corps.id } })).foyerId, mien.foyer.id);
    assert.equal((await prisma.credit.findUnique({ where: { id: credit.corps.id } })).foyerId, mien.foyer.id);
    assert.equal((await prisma.projet.findUnique({ where: { id: projet.corps.id } })).foyerId, mien.foyer.id);
    assert.equal((await prisma.placement.findUnique({ where: { id: placement.corps.id } })).foyerId, mien.foyer.id);
  });
});

testIntegration("le mode de répartition ne s'applique qu'au foyer connecté", async () => {
  await avecDeuxFoyers(async (mien, voisin) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, mien);

    assert.equal((await client.appel("/foyer", "PUT", { repartition: "moitie" })).code, 200);

    assert.equal((await prisma.foyer.findUnique({ where: { id: mien.foyer.id } })).repartition, "moitie");
    assert.equal((await prisma.foyer.findUnique({ where: { id: voisin.foyer.id } })).repartition, "prorata");
  });
});
