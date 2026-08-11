// Export et suppression de compte.
//
// Ces deux droits ne s'exercent qu'une fois, et sans recours : un export
// incomplet ne se remarque qu'au moment où l'on en aurait eu besoin, et une
// suppression qui laisse des restes ne se rattrape pas.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  chargerPrisma,
  machineDEssai,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { creerClient } from "./aide/client.js";

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

/** Un foyer avec un peu de tout, pour qu'un export vide ne passe pas inaperçu. */
async function garnir(prisma, foyerId) {
  const membre = await prisma.membre.create({ data: { nom: "Témoin", revenuMensuel: 250000, foyerId } });
  await prisma.transaction.create({
    data: { type: "depense", libelle: "Loyer", montant: 98000, categorie: "Logement", recurrent: true, membreId: membre.id, foyerId },
  });
  await prisma.credit.create({ data: { libelle: "Voiture", capital: 1400000, taux: 3.9, dureeMois: 60, moisDebut: "2026-01", foyerId } });
  const projet = await prisma.projet.create({ data: { libelle: "Voyage", objectif: 600000, echeance: "2027-10", versementMensuel: 25000, foyerId } });
  await prisma.versement.create({ data: { projetId: projet.id, montant: 50000, membreId: membre.id } });
  await prisma.placement.create({ data: { libelle: "Livret A", valeur: 840000, versementMensuel: 15000, rendement: 2.4, foyerId } });
}

/* ─── Export ─────────────────────────────────────────────────────────────── */

testIntegration("l'export contient tout le foyer, en euros et lisible", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    await garnir(prisma, contexte.foyer.id);
    const client = await clientConnecte(serveur.base, contexte);

    const r = await client.appel("/auth/mes-donnees");
    assert.equal(r.code, 200);
    assert.equal(r.corps.compte.email, contexte.email);
    assert.equal(r.corps.membres.length, 1);
    assert.equal(r.corps.credits.length, 1);
    assert.equal(r.corps.placements.length, 1);
    assert.equal(r.corps.projets.length, 1);
    // L'historique des versements fait partie des données : c'est lui qu'on a
    // voulu préserver en remplaçant le total figé du prototype.
    assert.equal(r.corps.projets[0].versements.length, 1);
    // Des centimes dans un fichier destiné à être lu par un humain seraient une
    // trahison de la promesse « vous pouvez emporter vos données ».
    assert.equal(r.corps.transactions[0].montant, 980);
  });
});

testIntegration("l'export ne laisse jamais fuiter le mot de passe", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/auth/mes-donnees");
    const tout = JSON.stringify(r.corps);
    assert.ok(!tout.includes("scrypt"), "l'empreinte du mot de passe ne doit pas sortir");
    assert.ok(!tout.includes("motDePasse"), "aucun champ de mot de passe ne doit apparaître");
  });
});

testIntegration("l'export s'arrête aux frontières du foyer", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const prisma = await chargerPrisma();
      await garnir(prisma, mien.foyer.id);
      await garnir(prisma, voisin.foyer.id);

      const client = await clientConnecte(serveur.base, mien);
      const r = await client.appel("/auth/mes-donnees");
      assert.equal(r.corps.membres.length, 1, "un seul foyer doit être exporté");
      assert.equal(r.corps.credits.length, 1);
    });
  });
});

testIntegration("l'export exige une session", async () => {
  const client = creerClient(serveur.base, machineDEssai());
  assert.equal((await client.appel("/auth/mes-donnees")).code, 401);
});

/* ─── Suppression ────────────────────────────────────────────────────────── */

testIntegration("supprimer son compte efface tout le foyer", async () => {
  const prisma = await chargerPrisma();
  let foyerId = null;
  let utilisateurId = null;

  await avecFoyer(async (contexte) => {
    foyerId = contexte.foyer.id;
    utilisateurId = contexte.utilisateur.id;
    await garnir(prisma, foyerId);
    const client = await clientConnecte(serveur.base, contexte);

    const r = await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse });
    assert.equal(r.code, 204);
    assert.equal(client.cookie, null, "la session doit être close dans la foulée");
  });

  // Les cascades partent du foyer : supprimer le compte seul aurait laissé
  // derrière lui des données que plus personne n'aurait pu ni voir ni effacer.
  const restes = await Promise.all([
    prisma.foyer.count({ where: { id: foyerId } }),
    prisma.utilisateur.count({ where: { id: utilisateurId } }),
    prisma.membre.count({ where: { foyerId } }),
    prisma.transaction.count({ where: { foyerId } }),
    prisma.credit.count({ where: { foyerId } }),
    prisma.projet.count({ where: { foyerId } }),
    prisma.placement.count({ where: { foyerId } }),
    prisma.session.count({ where: { utilisateurId } }),
    prisma.jeton.count({ where: { utilisateurId } }),
  ]);
  assert.deepEqual(restes, [0, 0, 0, 0, 0, 0, 0, 0, 0], "aucune trace ne doit subsister");
});

testIntegration("un mot de passe erroné ne supprime rien", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    const r = await client.appel("/auth/moi", "DELETE", { motDePasse: "ce n'est pas le bon" });
    assert.equal(r.code, 403);
    assert.equal(await prisma.foyer.count({ where: { id: contexte.foyer.id } }), 1);
    assert.equal((await client.appel("/auth/moi")).code, 200, "la session doit survivre au refus");
  });
});

testIntegration("la suppression exige une session", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = creerClient(serveur.base, machineDEssai());
    const r = await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse });
    assert.equal(r.code, 401);
    assert.equal(await prisma.foyer.count({ where: { id: contexte.foyer.id } }), 1);
  });
});

testIntegration("sur un foyer partagé, seul le compte s'en va", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    await garnir(prisma, contexte.foyer.id);

    // Un second compte sur le même foyer, propriétaire lui aussi.
    const second = await prisma.utilisateur.create({
      data: {
        email: `second-${contexte.email}`,
        motDePasseHash: contexte.utilisateur.motDePasseHash,
        emailValideLe: new Date(),
        foyerId: contexte.foyer.id,
        role: "proprietaire",
      },
    });

    const client = await clientConnecte(serveur.base, contexte);
    assert.equal((await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse })).code, 204);

    // Le budget appartient aussi à l'autre : l'emporter détruirait ses données.
    assert.equal(await prisma.foyer.count({ where: { id: contexte.foyer.id } }), 1, "le foyer doit survivre");
    assert.equal(await prisma.membre.count({ where: { foyerId: contexte.foyer.id } }), 1, "les données restent");
    assert.equal(await prisma.utilisateur.count({ where: { id: contexte.utilisateur.id } }), 0, "le compte, lui, s'en va");
    assert.equal(await prisma.utilisateur.count({ where: { id: second.id } }), 1);
  });
});

testIntegration("le dernier propriétaire ne peut pas partir en laissant le foyer", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    // Un compagnon simple membre : personne ne pourrait plus inviter ni
    // supprimer le foyer si le seul propriétaire s'en allait.
    await prisma.utilisateur.create({
      data: {
        email: `membre-${contexte.email}`,
        motDePasseHash: contexte.utilisateur.motDePasseHash,
        emailValideLe: new Date(),
        foyerId: contexte.foyer.id,
        role: "membre",
      },
    });

    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse });
    assert.equal(r.code, 409);
    assert.match(r.corps.erreur, /dernier propriétaire/i);
    assert.equal(await prisma.utilisateur.count({ where: { id: contexte.utilisateur.id } }), 1);
  });
});

testIntegration("supprimer son compte ne touche pas au foyer voisin", async () => {
  await avecFoyer(async (voisin) => {
    const prisma = await chargerPrisma();
    await garnir(prisma, voisin.foyer.id);

    await avecFoyer(async (mien) => {
      const client = await clientConnecte(serveur.base, mien);
      assert.equal((await client.appel("/auth/moi", "DELETE", { motDePasse: mien.motDePasse })).code, 204);
    });

    assert.equal(await prisma.foyer.count({ where: { id: voisin.foyer.id } }), 1);
    assert.equal(await prisma.membre.count({ where: { foyerId: voisin.foyer.id } }), 1);
  });
});
