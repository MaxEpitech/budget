// Limitation de cadence.
//
// C'est la seule chose qui sépare un mot de passe d'une attaque par
// épuisement. Deux compteurs la composent, et l'un sans l'autre laisse une
// porte ouverte : par adresse email seule, on balaie mille comptes depuis une
// machine ; par machine seule, on s'acharne sur un compte depuis plusieurs.
//
// Chaque scénario se présente comme une machine différente, sinon ils se
// bloqueraient les uns les autres — et saturer la boucle locale gênerait aussi
// l'application de développement.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  chargerPrisma,
  machineDEssai,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { creerClient } from "./aide/client.js";

let serveur = null;
let rendreLaParole = null;

const PLAFOND_CONNEXION_PAR_COMPTE = 10;
const PLAFOND_JETON_PAR_MACHINE = 30;

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

/** Frappe jusqu'au refus, et renvoie le nombre de coups admis avant blocage. */
async function frapperJusquAuRefus(client, chemin, corps, maximum) {
  for (let coup = 1; coup <= maximum; coup++) {
    const r = await client.appel(chemin, "POST", corps);
    if (r.code === 429) return { admis: coup - 1, refus: r };
  }
  return { admis: maximum, refus: null };
}

testIntegration("la connexion se ferme après dix essais sur un même compte", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    const { admis, refus } = await frapperJusquAuRefus(
      client,
      "/auth/connexion",
      { email: contexte.email, motDePasse: "ce n'est pas le bon" },
      PLAFOND_CONNEXION_PAR_COMPTE + 3,
    );

    assert.equal(admis, PLAFOND_CONNEXION_PAR_COMPTE);
    assert.ok(refus, "le plafond doit finir par être atteint");
    assert.match(refus.corps.erreur, /trop de tentatives/i);
  });
});

testIntegration("le bon mot de passe ne sauve pas d'un compte déjà bloqué", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    await frapperJusquAuRefus(
      client,
      "/auth/connexion",
      { email: contexte.email, motDePasse: "ce n'est pas le bon" },
      PLAFOND_CONNEXION_PAR_COMPTE + 1,
    );

    // Le blocage porte sur le compte, pas sur la validité des identifiants :
    // sinon l'attaquant saurait qu'il a trouvé le bon au moment où ça passe.
    const avecLeBon = await client.appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: contexte.motDePasse,
    });
    assert.equal(avecLeBon.code, 429);
  });
});

testIntegration("bloquer un compte n'en bloque pas un autre", async () => {
  await avecFoyer(async (cible) => {
    await avecFoyer(async (voisin) => {
      const client = nouveauClient();
      await frapperJusquAuRefus(
        client,
        "/auth/connexion",
        { email: cible.email, motDePasse: "ce n'est pas le bon" },
        PLAFOND_CONNEXION_PAR_COMPTE + 1,
      );

      // Même machine, autre compte : le compteur par adresse doit être distinct.
      const autre = await client.appel("/auth/connexion", "POST", {
        email: voisin.email,
        motDePasse: voisin.motDePasse,
      });
      assert.equal(autre.code, 200, "un compte innocent ne doit pas payer pour un autre");
    });
  });
});

testIntegration("bloquer une machine n'en bloque pas une autre", async () => {
  const client = nouveauClient();
  const { admis, refus } = await frapperJusquAuRefus(
    client,
    "/auth/validation",
    { jeton: "jeton-invente" },
    PLAFOND_JETON_PAR_MACHINE + 3,
  );

  assert.equal(admis, PLAFOND_JETON_PAR_MACHINE);
  assert.ok(refus);

  // Une autre machine repart de zéro : l'application fait bien confiance à
  // l'en-tête posé par l'intermédiaire, au lieu de voir tout le monde pareil.
  const ailleurs = nouveauClient();
  assert.equal((await ailleurs.appel("/auth/validation", "POST", { jeton: "jeton-invente" })).code, 400);
});

testIntegration("les compteurs vivent en base, pas dans l'instance", async () => {
  await avecFoyer(async (contexte) => {
    const machine = machineDEssai();
    const client = creerClient(serveur.base, machine);
    await frapperJusquAuRefus(
      client,
      "/auth/connexion",
      { email: contexte.email, motDePasse: "ce n'est pas le bon" },
      PLAFOND_CONNEXION_PAR_COMPTE + 1,
    );

    const prisma = await chargerPrisma();
    const compteurs = await prisma.limiteCadence.findMany({
      where: { cle: { contains: contexte.email } },
      select: { cle: true, compteur: true },
    });
    assert.ok(compteurs.length > 0, "le compteur doit être en base, sinon il disparaît avec l'instance");
    assert.ok(compteurs[0].compteur > PLAFOND_CONNEXION_PAR_COMPTE);

    // Un second serveur, comme une instance neuve chez l'hébergeur : le blocage
    // doit tenir, alors qu'un compteur en mémoire serait reparti de zéro.
    const autreInstance = await demarrerServeur();
    try {
      const depuisAilleurs = creerClient(autreInstance.base, machine);
      const r = await depuisAilleurs.appel("/auth/connexion", "POST", {
        email: contexte.email,
        motDePasse: contexte.motDePasse,
      });
      assert.equal(r.code, 429, "une instance neuve doit hériter du blocage");
    } finally {
      await autreInstance.arreter();
    }
  });
});

testIntegration("les compteurs des différents limiteurs ne se mélangent pas", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    // Une demande d'email et une tentative de connexion sur la même adresse :
    // les deux limiteurs classent par email, et partagent la même table.
    await client.appel("/auth/mot-de-passe-oublie", "POST", { email: contexte.email });
    await client.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: "faux" });

    const prisma = await chargerPrisma();
    const cles = (
      await prisma.limiteCadence.findMany({
        where: { cle: { contains: contexte.email } },
        select: { cle: true, compteur: true },
      })
    ).sort((a, b) => a.cle.localeCompare(b.cle));

    assert.equal(cles.length, 2, "chaque limiteur doit avoir sa propre case");
    for (const { cle, compteur } of cles) {
      assert.equal(compteur, 1, `${cle} ne doit compter que ses propres coups`);
    }
  });
});

testIntegration("les routes métier sont elles aussi comptées, par compte", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = nouveauClient();
    await client.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: contexte.motDePasse });

    await client.appel("/etat");
    await client.appel("/membres");

    // Le plafond est trop haut pour être atteint dans un test ; ce qui compte
    // est que le compteur existe et soit classé par compte, non par machine :
    // deux personnes derrière la même connexion ne doivent pas se gêner.
    const compteur = await prisma.limiteCadence.findFirst({
      where: { cle: `metier-compte:${contexte.utilisateur.id}` },
    });
    assert.ok(compteur, "les routes métier doivent alimenter un compteur");
    assert.ok(compteur.compteur >= 2, `deux appels au moins attendus, vu ${compteur?.compteur}`);

    await prisma.limiteCadence.deleteMany({ where: { cle: { contains: contexte.utilisateur.id } } });
  });
});

testIntegration("la sonde de santé interroge vraiment la base", async () => {
  const client = nouveauClient();
  const r = await client.appel("/ping");
  assert.equal(r.code, 200);
  assert.deepEqual(r.corps, { ok: true });
});

testIntegration("chaque réponse porte un identifiant de requête", async () => {
  const reponse = await fetch(`${serveur.base}/ping`);
  assert.ok(reponse.headers.get("x-request-id"), "sans lui, impossible de relier une trace à un incident");
});

testIntegration("les demandes d'email sont plafonnées séparément", async () => {
  await avecFoyer(async (contexte) => {
    const client = nouveauClient();
    const { admis, refus } = await frapperJusquAuRefus(
      client,
      "/auth/mot-de-passe-oublie",
      { email: contexte.email },
      8,
    );

    assert.equal(admis, 5, "cinq envois par heure et par adresse");
    assert.match(refus.corps.erreur, /trop de demandes/i);

    // La connexion reste possible : c'est un autre compteur.
    const connexion = await client.appel("/auth/connexion", "POST", {
      email: contexte.email,
      motDePasse: contexte.motDePasse,
    });
    assert.equal(connexion.code, 200);
  });
});
