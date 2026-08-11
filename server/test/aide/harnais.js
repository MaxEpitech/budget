// Harnais des tests d'intégration.
//
// ─── Pourquoi ce fichier est particulier ──────────────────────────────────
// db.js construit le client Prisma au moment de son import : l'URL de la base
// est donc lue une fois pour toutes, à ce moment-là. Pour diriger les tests
// vers une base d'essai, il faut avoir remplacé DATABASE_URL AVANT que le
// moindre module du serveur ne soit chargé.
//
// En ESM, les imports statiques d'un fichier sont évalués avant son corps.
// Ce module fait donc deux choses dans cet ordre : il substitue l'URL dans son
// propre corps, puis il charge les modules du serveur par import dynamique.
//
// Conséquence pour les tests : ils importent CE fichier, jamais directement un
// module de src/. Passer outre ferait tourner les tests sur la base réelle.
//
// ─── Sécurité ─────────────────────────────────────────────────────────────
// Le harnais ne supprime que les foyers qu'il a lui-même créés, jamais en
// masse. Même dirigé par erreur vers une base peuplée, il ne peut pas emporter
// des données existantes.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Le .env de la racine, seul endroit où DATABASE_URL_TEST est déclarée.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const urlEssai = process.env.DATABASE_URL_TEST;

/** Y a-t-il une base d'essai ? Sinon les tests d'intégration sont ignorés. */
export const baseDEssaiDisponible = Boolean(urlEssai);

// dotenv n'écrase jamais une variable déjà posée : cette substitution tient
// donc, y compris quand env.js rechargera le .env plus tard.
if (urlEssai) process.env.DATABASE_URL = urlEssai;

const RAISON = "DATABASE_URL_TEST absente : test d'intégration ignoré";

/**
 * Comme `test`, mais ignoré — et non en échec — quand aucune base d'essai n'est
 * configurée. `npm test` doit rester utilisable hors ligne, sinon plus personne
 * ne le lance.
 */
export const testIntegration = (nom, fn) =>
  test(nom, baseDEssaiDisponible ? {} : { skip: RAISON }, fn);

/* ─── Accès aux modules du serveur ───────────────────────────────────────── */

export const chargerPrisma = async () => (await import("../../src/db.js")).prisma;
export const chargerJetons = async () => import("../../src/auth/jetons.js");
export const chargerSecrets = async () => import("../../src/auth/secrets.js");

/**
 * Une adresse de machine différente à chaque appel.
 *
 * Les tests de cadence s'en servent pour que chaque scénario dispose de ses
 * propres compteurs : sans cela ils se bloqueraient les uns les autres, et
 * saturer la boucle locale gênerait aussi l'application de développement, dont
 * les requêtes arrivent par le même chemin.
 */
// Plage réservée à la documentation par la RFC 5737 : jamais routable.
export const PREFIXE_MACHINE = "203.0.113.";

let numeroMachine = 0;
export const machineDEssai = () => {
  numeroMachine += 1;
  return { "X-Forwarded-For": `${PREFIXE_MACHINE}${(numeroMachine % 250) + 1}` };
};

/**
 * Fait taire l'affichage des emails pendant un test.
 *
 * Sans clé d'envoi, chaque email est écrit en entier dans le journal — ce qui
 * noierait la sortie des tests d'authentification. Les erreurs, elles, passent
 * toujours.
 */
export function silencieux() {
  const original = console.log;
  console.log = () => {};
  return () => {
    console.log = original;
  };
}

/**
 * Met l'application à l'écoute d'un port libre choisi par le système : aucun
 * port fixe, donc aucun conflit avec le serveur de développement ni entre
 * fichiers de tests exécutés en parallèle.
 */
export async function demarrerServeur() {
  const { default: app } = await import("../../src/app.js");
  const serveur = app.listen(0);
  await once(serveur, "listening");
  const { port } = serveur.address();

  return {
    base: `http://127.0.0.1:${port}/api`,
    async arreter() {
      serveur.close();
      await once(serveur, "close");
    },
  };
}

/* ─── Foyers jetables ────────────────────────────────────────────────────── */

export const MOT_DE_PASSE_ESSAI = "phrase de passe pour les essais";

// Le hachage coûte environ 235 ms : on ne le paie qu'une fois pour toute la
// série, tous les foyers jetables partageant le même mot de passe.
let empreintePartagee = null;
async function empreinteEssai() {
  if (!empreintePartagee) {
    const { hacherMotDePasse } = await import("../../src/auth/motDePasse.js");
    empreintePartagee = await hacherMotDePasse(MOT_DE_PASSE_ESSAI);
  }
  return empreintePartagee;
}

/**
 * Crée un foyer isolé et son compte, déjà confirmé. Le domaine « .invalid » est
 * réservé par la norme : aucune de ces adresses ne peut exister réellement.
 */
export async function creerFoyerJetable() {
  const prisma = await chargerPrisma();
  const email = `essai-${randomUUID()}@essai.invalid`;

  const foyer = await prisma.foyer.create({ data: {} });
  const utilisateur = await prisma.utilisateur.create({
    data: {
      email,
      motDePasseHash: await empreinteEssai(),
      emailValideLe: new Date(),
      foyerId: foyer.id,
    },
  });

  return {
    foyer,
    utilisateur,
    email,
    motDePasse: MOT_DE_PASSE_ESSAI,
    prisma,
    /** Supprimer le foyer emporte le compte et toutes ses données en cascade. */
    async nettoyer() {
      await prisma.foyer.delete({ where: { id: foyer.id } }).catch(() => {});
      // Les connexions du test ont incrémenté des compteurs de cadence, qui ne
      // sont rattachés à aucune table et survivraient donc au foyer.
      await prisma.limiteCadence.deleteMany({ where: { cle: { contains: email } } }).catch(() => {});
    },
  };
}

/**
 * Remet à zéro les compteurs de cadence que les tests produisent : ceux des
 * adresses d'essai, des machines simulées, et de la boucle locale d'où partent
 * les requêtes.
 *
 * Nécessaire dès qu'un fichier enchaîne les connexions : sans cela, la dixième
 * ferait tomber le plafond et le test échouerait pour la mauvaise raison. Les
 * compteurs des vraies adresses ne sont jamais touchés.
 *
 * Cette purge n'est sûre que parce que les fichiers de tests s'exécutent l'un
 * après l'autre (voir --test-concurrency dans le script npm) : en parallèle,
 * elle remettrait à zéro les compteurs qu'un autre fichier est en train de
 * compter.
 */
export async function reinitialiserCadenceEssais() {
  const prisma = await chargerPrisma();
  await prisma.limiteCadence.deleteMany({
    where: {
      OR: [
        { cle: { contains: "@essai.invalid" } },
        { cle: { contains: PREFIXE_MACHINE } },
        { cle: { endsWith: ":127.0.0.1" } },
        // Forme normalisée de la boucle locale IPv6 par express-rate-limit.
        { cle: { endsWith: "::/56" } },
      ],
    },
  });
}

/**
 * Exécute un scénario avec un foyer jetable, supprimé quoi qu'il arrive —
 * y compris si le test échoue au milieu. Sans ce `finally`, un échec laisserait
 * des foyers derrière lui et le suivant partirait d'un état pollué.
 */
export async function avecFoyer(scenario) {
  const contexte = await creerFoyerJetable();
  try {
    return await scenario(contexte);
  } finally {
    await contexte.nettoyer();
  }
}

/** Un client déjà connecté sur le foyer indiqué. */
export async function clientConnecte(base, contexte) {
  const { creerClient } = await import("./client.js");
  const client = creerClient(base);
  const r = await client.appel("/auth/connexion", "POST", {
    email: contexte.email,
    motDePasse: contexte.motDePasse,
  });
  if (r.code !== 200) {
    throw new Error(`Connexion du foyer d'essai impossible : ${r.code} ${JSON.stringify(r.corps)}`);
  }
  return client;
}
