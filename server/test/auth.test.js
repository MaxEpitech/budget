// Parcours d'authentification, de l'inscription à la réinitialisation.
//
// C'est la partie la plus riche en cas limites, et celle dont les erreurs
// seraient les plus discrètes : un jeton rejouable, un message qui trahit
// l'existence d'un compte, une session qui survit à un changement de mot de
// passe ne se voient pas à l'usage.
//
// Chaque client se présente comme une machine distincte : les compteurs de
// cadence restent ainsi séparés, et ceux de la boucle locale — partagés avec
// l'application de développement — ne sont jamais touchés.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  chargerPrisma,
  chargerJetons,
  chargerSecrets,
  machineDEssai,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { creerClient } from "./aide/client.js";

let serveur = null;
let rendreLaParole = null;

const MOT_DE_PASSE = "phrase de passe du foyer";
const adresseNeuve = () => `essai-${Date.now()}-${Math.trunc(Math.random() * 1e6)}@essai.invalid`;

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

/** Supprime un compte d'essai et son foyer, quoi qu'il soit advenu du test. */
async function oublier(email) {
  const prisma = await chargerPrisma();
  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
  if (!utilisateur) return;
  await prisma.foyer.delete({ where: { id: utilisateur.foyerId } }).catch(() => {});
  await prisma.limiteCadence.deleteMany({ where: { cle: { contains: email } } }).catch(() => {});
}

/**
 * Exécute un scénario avec la confirmation par email exigée.
 *
 * Le réglage est relu à chaque appel, jamais figé au chargement : on peut donc
 * le basculer le temps d'un test. Les fichiers de tests s'exécutant chacun dans
 * leur processus, et les tests d'un même fichier l'un après l'autre, cette
 * bascule ne peut pas déborder sur un autre scénario.
 */
async function avecConfirmationExigee(scenario) {
  const avant = process.env.CONFIRMATION_EMAIL_REQUISE;
  process.env.CONFIRMATION_EMAIL_REQUISE = "1";
  try {
    return await scenario();
  } finally {
    if (avant === undefined) delete process.env.CONFIRMATION_EMAIL_REQUISE;
    else process.env.CONFIRMATION_EMAIL_REQUISE = avant;
  }
}

/* ═══ Inscription, compte utilisable immédiatement ═══════════════════════ */

testIntegration("l'inscription ouvre la session et donne accès au budget", async () => {
  const email = adresseNeuve();
  try {
    const client = nouveauClient();
    const r = await client.appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });

    assert.equal(r.code, 201);
    assert.deepEqual(r.corps, { email, emailValide: true });
    assert.ok(client.cookie, "une session doit être ouverte");
    assert.equal((await client.appel("/etat")).code, 200);

    const prisma = await chargerPrisma();
    const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
    assert.ok(utilisateur.emailValideLe, "l'adresse doit être marquée confirmée");
    assert.ok(
      utilisateur.motDePasseHash.startsWith("scrypt$") && !utilisateur.motDePasseHash.includes(MOT_DE_PASSE),
      "le mot de passe ne doit jamais être stocké en clair",
    );
    assert.equal(
      await prisma.jeton.count({ where: { utilisateurId: utilisateur.id } }),
      0,
      "aucun jeton ne sert quand la confirmation n'est pas exigée",
    );
  } finally {
    await oublier(email);
  }
});

testIntegration("une adresse déjà prise est annoncée franchement", async () => {
  const email = adresseNeuve();
  try {
    await nouveauClient().appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });
    const r = await nouveauClient().appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });

    // Sans confirmation, l'inscription ouvre la session : réussir ou échouer
    // révèle de toute façon l'existence du compte. Autant le dire clairement
    // plutôt que de laisser attendre un email qui n'arrivera pas.
    assert.equal(r.code, 409);
    assert.match(r.corps.erreur, /déjà un compte/i);

    const prisma = await chargerPrisma();
    assert.equal(await prisma.utilisateur.count({ where: { email } }), 1);
  } finally {
    await oublier(email);
  }
});

testIntegration("l'adresse est normalisée : espaces et majuscules", async () => {
  const email = adresseNeuve();
  try {
    await nouveauClient().appel("/auth/inscription", "POST", {
      email: `  ${email.toUpperCase()}  `,
      motDePasse: MOT_DE_PASSE,
    });

    const prisma = await chargerPrisma();
    assert.ok(await prisma.utilisateur.findUnique({ where: { email } }), "l'adresse doit être rangée en minuscules");

    const connexion = await nouveauClient().appel("/auth/connexion", "POST", {
      email: `  ${email.toUpperCase()}  `,
      motDePasse: MOT_DE_PASSE,
    });
    assert.equal(connexion.code, 200, "les variantes d'écriture doivent mener au même compte");
  } finally {
    await oublier(email);
  }
});

testIntegration("les entrées invalides sont refusées avec un message utile", async () => {
  const client = nouveauClient();
  const cas = [
    // Adresse volontairement invalide — la double arobase suffit — mais qui
    // porte le marqueur des essais : la cadence s'applique avant la validation,
    // et le compteur qu'elle crée doit pouvoir être purgé comme les autres.
    [{ email: "pas-une-adresse@@essai.invalid", motDePasse: MOT_DE_PASSE }, /adresse invalide/i],
    [{ email: adresseNeuve(), motDePasse: "trop court" }, /12 caractères/i],
    [{ email: adresseNeuve() }, /mot de passe/i],
    [{ motDePasse: MOT_DE_PASSE }, /email/i],
  ];
  for (const [corps, attendu] of cas) {
    const r = await client.appel("/auth/inscription", "POST", corps);
    assert.equal(r.code, 400, `refus attendu pour ${JSON.stringify(corps)}`);
    assert.match(r.corps.erreur, attendu);
  }
});

/* ═══ Inscription avec confirmation exigée ═══════════════════════════════ */

testIntegration("avec confirmation exigée, l'inscription n'ouvre aucune session", async () => {
  const email = adresseNeuve();
  try {
    await avecConfirmationExigee(async () => {
      const client = nouveauClient();
      const r = await client.appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });

      assert.equal(r.code, 201);
      assert.ok(r.corps.message, "la réponse doit être un message, pas un profil");
      assert.equal(r.corps.email, undefined);
      assert.equal(client.cookie, null, "aucune session tant que l'adresse n'est pas confirmée");

      const prisma = await chargerPrisma();
      const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
      assert.equal(utilisateur.emailValideLe, null);
      assert.equal(await prisma.jeton.count({ where: { utilisateurId: utilisateur.id, type: "validation" } }), 1);

      const connexion = await nouveauClient().appel("/auth/connexion", "POST", { email, motDePasse: MOT_DE_PASSE });
      assert.equal(connexion.code, 403);
      assert.equal(connexion.corps.motif, "email_non_valide");
    });
  } finally {
    await oublier(email);
  }
});

testIntegration("avec confirmation exigée, une adresse connue reste indiscernable", async () => {
  const email = adresseNeuve();
  try {
    await avecConfirmationExigee(async () => {
      const premiere = await nouveauClient().appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });
      const seconde = await nouveauClient().appel("/auth/inscription", "POST", { email, motDePasse: MOT_DE_PASSE });

      // Si les réponses différaient, le formulaire d'inscription deviendrait un
      // annuaire : il suffirait d'essayer des adresses pour savoir lesquelles
      // sont enregistrées.
      assert.equal(seconde.code, premiere.code);
      assert.deepEqual(seconde.corps, premiere.corps);

      const prisma = await chargerPrisma();
      assert.equal(await prisma.utilisateur.count({ where: { email } }), 1, "aucun second compte ne doit naître");
    });
  } finally {
    await oublier(email);
  }
});

/* ═══ Jetons de confirmation ═════════════════════════════════════════════ */

testIntegration("le lien de confirmation ouvre la session et ne sert qu'une fois", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    await prisma.utilisateur.update({ where: { id: contexte.utilisateur.id }, data: { emailValideLe: null } });

    const { emettreJeton } = await chargerJetons();
    const jeton = await emettreJeton(contexte.utilisateur.id, "validation");

    const client = nouveauClient();
    const r = await client.appel("/auth/validation", "POST", { jeton });
    assert.equal(r.code, 200);
    assert.equal(r.corps.emailValide, true);
    assert.ok(client.cookie, "la confirmation doit ouvrir la session dans la foulée");

    const rejeu = await nouveauClient().appel("/auth/validation", "POST", { jeton });
    assert.equal(rejeu.code, 400, "un lien déjà suivi ne doit plus rien ouvrir");
  });
});

testIntegration("un jeton inventé, périmé, ou d'un autre type est refusé", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const { emettreJeton } = await chargerJetons();
    const { empreinte } = await chargerSecrets();
    const client = nouveauClient();

    assert.equal((await client.appel("/auth/validation", "POST", { jeton: "inventé" })).code, 400);
    assert.equal((await client.appel("/auth/validation", "POST", { jeton: "" })).code, 400);

    // Un jeton de réinitialisation ne doit pas confirmer une adresse.
    const autreType = await emettreJeton(contexte.utilisateur.id, "reinitialisation");
    assert.equal((await client.appel("/auth/validation", "POST", { jeton: autreType })).code, 400);

    const perime = await emettreJeton(contexte.utilisateur.id, "validation");
    await prisma.jeton.updateMany({
      where: { jetonHache: empreinte(perime) },
      data: { expireLe: new Date(Date.now() - 1000) },
    });
    assert.equal((await client.appel("/auth/validation", "POST", { jeton: perime })).code, 400);
  });
});

testIntegration("émettre un nouveau lien périme le précédent", async () => {
  await avecFoyer(async (contexte) => {
    const { emettreJeton } = await chargerJetons();
    const ancien = await emettreJeton(contexte.utilisateur.id, "validation");
    const nouveau = await emettreJeton(contexte.utilisateur.id, "validation");

    const client = nouveauClient();
    assert.equal((await client.appel("/auth/validation", "POST", { jeton: ancien })).code, 400);
    assert.equal((await nouveauClient().appel("/auth/validation", "POST", { jeton: nouveau })).code, 200);
  });
});

/* ═══ Connexion et sessions ══════════════════════════════════════════════ */

testIntegration("le cookie de session est protégé", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    const r = await client.appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: contexte.motDePasse,
    });
    assert.equal(r.code, 200);

    const cookie = r.cookiesPoses.find((c) => c.startsWith("session="));
    assert.ok(/HttpOnly/i.test(cookie), "le cookie doit être hors de portée du JavaScript");
    assert.ok(/SameSite=Lax/i.test(cookie), "SameSite protège des requêtes venues d'un autre site");
    assert.ok(/Path=\//i.test(cookie));
  });
});

testIntegration("mot de passe erroné et adresse inconnue sont indiscernables", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    const mauvais = await client.appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: "ce n'est pas le bon",
    });
    const inconnue = await client.appel("/auth/connexion", "POST", {
      email: adresseNeuve(),
      motDePasse: "ce n'est pas le bon",
    });

    assert.equal(mauvais.code, 401);
    assert.equal(inconnue.code, mauvais.code);
    assert.deepEqual(inconnue.corps, mauvais.corps);
  });
});

testIntegration("la déconnexion révoque la session pour de bon", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    await client.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: contexte.motDePasse });
    const session = client.cookie;

    assert.equal((await client.appel("/auth/deconnexion", "POST")).code, 204);
    assert.equal(client.cookie, null);

    // Même en rejouant le cookie à la main, la session ne doit plus valoir.
    const rejeu = creerClient(serveur.base, { ...machineDEssai(), Cookie: session });
    assert.equal((await rejeu.appel("/auth/moi")).code, 401);
  });
});

testIntegration("les routes métier restent fermées sans session", async () => {
  const client = nouveauClient();
  for (const chemin of ["/etat", "/membres", "/transactions", "/credits", "/projets", "/placements"]) {
    assert.equal((await client.appel(chemin)).code, 401, `${chemin} devrait exiger une session`);
  }
  assert.equal((await client.appel("/foyer", "PUT", { repartition: "moitie" })).code, 401);
  assert.equal((await client.appel("/auth/moi")).code, 401);
});

/* ═══ Mot de passe oublié ════════════════════════════════════════════════ */

testIntegration("la demande répond pareil, que l'adresse existe ou non", async () => {
  await avecFoyer(async (contexte) => {
    const inconnue = adresseNeuve();
    const client = nouveauClient();

    const connue = await client.appel("/auth/mot-de-passe-oublie", "POST", { email: contexte.email });
    const jamaisVue = await client.appel("/auth/mot-de-passe-oublie", "POST", { email: inconnue });

    assert.equal(connue.code, 200);
    assert.equal(jamaisVue.code, connue.code);
    assert.deepEqual(jamaisVue.corps, connue.corps);

    const prisma = await chargerPrisma();
    assert.equal(
      await prisma.jeton.count({ where: { utilisateurId: contexte.utilisateur.id, type: "reinitialisation" } }),
      1,
      "un jeton doit être émis pour l'adresse connue",
    );
    assert.equal(await prisma.utilisateur.count({ where: { email: inconnue } }), 0);
  });
});

testIntegration("la réinitialisation change le mot de passe et coupe les autres sessions", async () => {
  await avecFoyer(async (contexte) => {
    const NOUVEAU = "une toute nouvelle phrase de passe";

    // Deux sessions ouvertes ailleurs, qui doivent tomber.
    const ailleurs = [nouveauClient(), nouveauClient()];
    for (const c of ailleurs) {
      await c.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: contexte.motDePasse });
    }

    const { emettreJeton } = await chargerJetons();
    const jeton = await emettreJeton(contexte.utilisateur.id, "reinitialisation");

    const client = nouveauClient();
    const r = await client.appel("/auth/reinitialiser", "POST", { jeton, motDePasse: NOUVEAU });
    assert.equal(r.code, 200);
    assert.ok(client.cookie, "la réinitialisation ouvre une session neuve");

    for (const c of ailleurs) {
      assert.equal((await c.appel("/auth/moi")).code, 401, "les sessions ouvertes ailleurs doivent tomber");
    }
    assert.equal((await client.appel("/auth/moi")).code, 200, "celle issue du lien survit");

    const ancien = await nouveauClient().appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: contexte.motDePasse,
    });
    assert.equal(ancien.code, 401, "l'ancien mot de passe ne doit plus valoir");

    const neuf = await nouveauClient().appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: NOUVEAU,
    });
    assert.equal(neuf.code, 200);
  });
});

testIntegration("un mot de passe refusé ne consomme pas le lien", async () => {
  await avecFoyer(async (contexte) => {
    const { emettreJeton } = await chargerJetons();
    const jeton = await emettreJeton(contexte.utilisateur.id, "reinitialisation");
    const client = nouveauClient();

    const trop = await client.appel("/auth/reinitialiser", "POST", { jeton, motDePasse: "court" });
    assert.equal(trop.code, 400);
    assert.match(trop.corps.erreur, /12 caractères/i);

    // Le hachage précède la consommation, précisément pour que ce cas n'use pas
    // le lien : sinon une faute de frappe obligerait à en redemander un.
    const ensuite = await client.appel("/auth/reinitialiser", "POST", {
      jeton,
      motDePasse: "une phrase de passe correcte",
    });
    assert.equal(ensuite.code, 200, "le lien devait rester utilisable");
  });
});

testIntegration("suivre le lien vaut confirmation de l'adresse", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    await prisma.utilisateur.update({ where: { id: contexte.utilisateur.id }, data: { emailValideLe: null } });

    const { emettreJeton } = await chargerJetons();
    const jeton = await emettreJeton(contexte.utilisateur.id, "reinitialisation");

    const r = await nouveauClient().appel("/auth/reinitialiser", "POST", {
      jeton,
      motDePasse: "une phrase de passe correcte",
    });
    assert.equal(r.code, 200);
    assert.equal(r.corps.emailValide, true, "un compte dont le lien de confirmation est perdu doit pouvoir s'en sortir");
  });
});

testIntegration("la date de première confirmation n'est jamais réécrite", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const origine = new Date("2026-01-15T10:00:00.000Z");
    await prisma.utilisateur.update({ where: { id: contexte.utilisateur.id }, data: { emailValideLe: origine } });

    const { emettreJeton } = await chargerJetons();
    const jeton = await emettreJeton(contexte.utilisateur.id, "reinitialisation");
    await nouveauClient().appel("/auth/reinitialiser", "POST", { jeton, motDePasse: "une phrase de passe correcte" });

    const apres = await prisma.utilisateur.findUnique({ where: { id: contexte.utilisateur.id } });
    assert.equal(apres.emailValideLe.toISOString(), origine.toISOString());
  });
});
