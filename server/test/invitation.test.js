// Invitations à rejoindre un foyer.
//
// C'est le seul endroit où un compte change de foyer. Les cas limites y sont
// donc particulièrement coûteux : rattacher quelqu'un dont le foyer contient
// des données les abandonnerait, et une invitation rejouable donnerait un accès
// permanent à un budget.
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

const nouveauClient = () => creerClient(serveur.base, machineDEssai());
const adresseNeuve = () => `invite-${Date.now()}-${Math.trunc(Math.random() * 1e6)}@essai.invalid`;

/** Le lien en clair n'existe qu'au moment de l'envoi : on le reprend du module. */
async function inviterDirectement(foyerId, email, extra = {}) {
  const { inviter } = await import("../src/auth/invitations.js");
  const { secret } = await inviter({ foyerId, email, role: "membre", ...extra });
  return secret;
}

/* ─── Émission ───────────────────────────────────────────────────────────── */

testIntegration("un propriétaire peut inviter, un simple membre non", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    const r = await client.appel("/foyer/invitations", "POST", { email: adresseNeuve() });
    assert.equal(r.code, 201);
    assert.equal(r.corps.role, "membre", "membre par défaut : on n'accorde pas les pleins pouvoirs sans le vouloir");

    await prisma.utilisateur.update({ where: { id: contexte.utilisateur.id }, data: { role: "membre" } });
    const refus = await client.appel("/foyer/invitations", "POST", { email: adresseNeuve() });
    assert.equal(refus.code, 403);
  });
});

testIntegration("inviter quelqu'un déjà présent est refusé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const soi = await client.appel("/foyer/invitations", "POST", { email: contexte.email });
    assert.equal(soi.code, 400);
    assert.match(soi.corps.erreur, /déjà partie/i);
  });
});

testIntegration("une nouvelle invitation remplace celle en attente", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const email = adresseNeuve();
    const premier = await inviterDirectement(contexte.foyer.id, email);
    const second = await inviterDirectement(contexte.foyer.id, email);

    // Sinon deux liens vivraient en parallèle, et révoquer le premier ne
    // fermerait rien.
    assert.equal(await prisma.invitation.count({ where: { foyerId: contexte.foyer.id, utiliseLe: null } }), 1);
    assert.equal((await nouveauClient().appel(`/auth/invitation?jeton=${encodeURIComponent(premier)}`)).code, 400);
    assert.equal((await nouveauClient().appel(`/auth/invitation?jeton=${encodeURIComponent(second)}`)).code, 200);
  });
});

testIntegration("une invitation révoquée ne vaut plus rien", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const email = adresseNeuve();
    const creation = await client.appel("/foyer/invitations", "POST", { email });
    const jeton = await inviterDirectement(contexte.foyer.id, email);

    const acces = await client.appel("/foyer/acces");
    const enAttente = acces.corps.invitations.find((i) => i.email === email);
    assert.ok(enAttente, "l'invitation doit apparaître parmi celles en attente");

    assert.equal((await client.appel(`/foyer/invitations/${enAttente.id}`, "DELETE")).code, 204);
    assert.equal((await nouveauClient().appel(`/auth/invitation?jeton=${encodeURIComponent(jeton)}`)).code, 400);
    void creation;
  });
});

/* ─── Acceptation par quelqu'un sans compte ──────────────────────────────── */

testIntegration("accepter sans compte en crée un, dans le bon foyer", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const email = adresseNeuve();
    const membre = await prisma.membre.create({ data: { nom: "Estelle", revenuMensuel: 198000, foyerId: contexte.foyer.id } });
    const jeton = await inviterDirectement(contexte.foyer.id, email, { membreId: membre.id });

    const client = nouveauClient();
    const apercu = await client.appel(`/auth/invitation?jeton=${encodeURIComponent(jeton)}`);
    assert.equal(apercu.code, 200);
    assert.equal(apercu.corps.email, email);
    assert.equal(apercu.corps.compteExistant, false);
    assert.equal(apercu.corps.membre.nom, "Estelle");

    const r = await client.appel("/auth/invitation", "POST", { jeton, motDePasse: "une phrase de passe correcte" });
    assert.equal(r.code, 201);
    assert.ok(client.cookie, "la session doit s'ouvrir dans la foulée");

    const cree = await prisma.utilisateur.findUnique({ where: { email }, include: { membre: true } });
    assert.equal(cree.foyerId, contexte.foyer.id);
    assert.equal(cree.role, "membre");
    // Suivre le lien prouve l'accès à la boîte mail : rien à confirmer de plus.
    assert.ok(cree.emailValideLe, "l'adresse doit être confirmée du même coup");
    assert.equal(cree.membre.id, membre.id, "le membre désigné doit être relié au compte");

    // Et le budget partagé lui est bien servi.
    const etat = await client.appel("/etat");
    assert.equal(etat.code, 200);
    assert.equal(etat.corps.membres.length, 1);
  });
});

testIntegration("accepter sans mot de passe est refusé", async () => {
  await avecFoyer(async (contexte) => {
    const jeton = await inviterDirectement(contexte.foyer.id, adresseNeuve());
    const r = await nouveauClient().appel("/auth/invitation", "POST", { jeton });
    assert.equal(r.code, 400);
    assert.equal(r.corps.motif, "mot_de_passe_requis");
  });
});

testIntegration("une invitation ne sert qu'une fois", async () => {
  await avecFoyer(async (contexte) => {
    const email = adresseNeuve();
    const jeton = await inviterDirectement(contexte.foyer.id, email);
    assert.equal((await nouveauClient().appel("/auth/invitation", "POST", { jeton, motDePasse: "une phrase de passe correcte" })).code, 201);

    // Rejouable, elle donnerait un accès permanent au budget.
    const rejeu = await nouveauClient().appel("/auth/invitation", "POST", { jeton, motDePasse: "une autre phrase de passe" });
    assert.equal(rejeu.code, 400);
  });
});

testIntegration("une invitation périmée est refusée", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const { empreinte } = await import("../src/auth/secrets.js");
    const jeton = await inviterDirectement(contexte.foyer.id, adresseNeuve());
    await prisma.invitation.update({
      where: { jetonHache: empreinte(jeton) },
      data: { expireLe: new Date(Date.now() - 1000) },
    });
    assert.equal((await nouveauClient().appel(`/auth/invitation?jeton=${encodeURIComponent(jeton)}`)).code, 400);
  });
});

/* ─── Acceptation par quelqu'un qui a déjà un compte ─────────────────────── */

testIntegration("un compte existant doit être connecté pour accepter", async () => {
  await avecFoyer(async (hote) => {
    await avecFoyer(async (invite) => {
      const jeton = await inviterDirectement(hote.foyer.id, invite.email);

      const anonyme = await nouveauClient().appel("/auth/invitation", "POST", { jeton });
      assert.equal(anonyme.code, 401);
      assert.equal(anonyme.corps.motif, "connexion_requise");

      // Connecté avec un AUTRE compte, l'invitation ne doit pas s'appliquer non plus.
      const autre = await clientConnecte(serveur.base, hote);
      assert.equal((await autre.appel("/auth/invitation", "POST", { jeton })).code, 401);
    });
  });
});

testIntegration("un compte au foyer vide rejoint, et son ancien foyer disparaît", async () => {
  await avecFoyer(async (hote) => {
    const prisma = await chargerPrisma();
    await prisma.membre.create({ data: { nom: "Témoin", revenuMensuel: 100000, foyerId: hote.foyer.id } });

    const invite = await (await import("./aide/harnais.js")).creerFoyerJetable();
    const ancienFoyerId = invite.foyer.id;
    try {
      const jeton = await inviterDirectement(hote.foyer.id, invite.email);
      const client = await clientConnecte(serveur.base, invite);

      const r = await client.appel("/auth/invitation", "POST", { jeton });
      assert.equal(r.code, 200);

      const deplace = await prisma.utilisateur.findUnique({ where: { id: invite.utilisateur.id } });
      assert.equal(deplace.foyerId, hote.foyer.id);
      assert.equal(await prisma.foyer.count({ where: { id: ancienFoyerId } }), 0, "le foyer vide quitté doit disparaître");

      const etat = await client.appel("/etat");
      assert.equal(etat.corps.membres.length, 1, "le budget partagé lui est servi");
    } finally {
      await prisma.utilisateur.deleteMany({ where: { id: invite.utilisateur.id } });
      await prisma.foyer.deleteMany({ where: { id: ancienFoyerId } });
    }
  });
});

testIntegration("un compte dont le foyer contient des données ne peut pas rejoindre", async () => {
  await avecFoyer(async (hote) => {
    await avecFoyer(async (invite) => {
      const prisma = await chargerPrisma();
      // Ses propres données seraient abandonnées derrière lui.
      await prisma.membre.create({ data: { nom: "À lui", revenuMensuel: 100000, foyerId: invite.foyer.id } });

      const jeton = await inviterDirectement(hote.foyer.id, invite.email);
      const client = await clientConnecte(serveur.base, invite);

      const r = await client.appel("/auth/invitation", "POST", { jeton });
      assert.equal(r.code, 409);
      assert.match(r.corps.erreur, /contient des données/i);

      const inchange = await prisma.utilisateur.findUnique({ where: { id: invite.utilisateur.id } });
      assert.equal(inchange.foyerId, invite.foyer.id, "le compte ne doit pas avoir bougé");
      // L'invitation ne doit pas avoir été consommée par un refus.
      assert.equal((await nouveauClient().appel(`/auth/invitation?jeton=${encodeURIComponent(jeton)}`)).code, 200);
    });
  });
});

/* ─── Gestion des accès ──────────────────────────────────────────────────── */

testIntegration("le foyer doit garder au moins un propriétaire", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    const seul = await client.appel(`/foyer/acces/${contexte.utilisateur.id}`, "PUT", { role: "membre" });
    assert.equal(seul.code, 409, "se rétrograder seul fermerait la porte de l'intérieur");

    const second = await prisma.utilisateur.create({
      data: { email: adresseNeuve(), motDePasseHash: contexte.utilisateur.motDePasseHash, emailValideLe: new Date(), foyerId: contexte.foyer.id, role: "proprietaire" },
    });
    const possible = await client.appel(`/foyer/acces/${contexte.utilisateur.id}`, "PUT", { role: "membre" });
    assert.equal(possible.code, 200, "avec un autre propriétaire, c'est permis");
    void second;
  });
});

testIntegration("retirer un compte ne touche pas au budget", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const membre = await prisma.membre.create({ data: { nom: "Estelle", revenuMensuel: 198000, foyerId: contexte.foyer.id } });
    const autre = await prisma.utilisateur.create({
      data: { email: adresseNeuve(), motDePasseHash: contexte.utilisateur.motDePasseHash, emailValideLe: new Date(), foyerId: contexte.foyer.id, role: "membre" },
    });
    await prisma.membre.update({ where: { id: membre.id }, data: { utilisateurId: autre.id } });

    const client = await clientConnecte(serveur.base, contexte);
    assert.equal((await client.appel(`/foyer/acces/${autre.id}`, "DELETE")).code, 204);

    // Le membre reste au budget avec son revenu et ses lignes ; seul l'accès part.
    const reste = await prisma.membre.findUnique({ where: { id: membre.id } });
    assert.ok(reste, "le membre du budget doit survivre au départ du compte");
    assert.equal(reste.utilisateurId, null);
    assert.equal(reste.revenuMensuel, 198000);
  });
});

testIntegration("on ne peut pas se retirer soi-même par cette porte", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel(`/foyer/acces/${contexte.utilisateur.id}`, "DELETE");
    assert.equal(r.code, 400);
    assert.match(r.corps.erreur, /supprimez votre compte/i);
  });
});

testIntegration("les accès d'un autre foyer sont hors de portée", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const client = await clientConnecte(serveur.base, mien);
      assert.equal((await client.appel(`/foyer/acces/${voisin.utilisateur.id}`, "PUT", { role: "membre" })).code, 404);
      assert.equal((await client.appel(`/foyer/acces/${voisin.utilisateur.id}`, "DELETE")).code, 404);
    });
  });
});
