// Client de l'API GoCardless Bank Account Data (ex-Nordigen).
//
// Seul fichier qui parle à GoCardless : les routes n'en connaissent que les
// fonctions exportées ici. Pas de dépendance — le `fetch` de Node suffit.
//
// ─── Réglages (.env) ──────────────────────────────────────────────────────
// GOCARDLESS_SECRET_ID / GOCARDLESS_SECRET_KEY : les identifiants créés dans le
// portail GoCardless. Sans eux l'agrégation est simplement indisponible, et
// l'application reste en saisie manuelle.
// GOCARDLESS_BASE_URL : à ne changer que pour viser un faux serveur en test.
//
// Les secrets ne quittent jamais ce fichier, et ne sont jamais journalisés.

const BASE_PAR_DEFAUT = "https://bankaccountdata.gocardless.com/api/v2";

// La fonction Vercel est coupée à 15 s : mieux vaut renoncer avant, et répondre
// une erreur lisible, que laisser l'hébergeur tuer la requête.
const DELAI_MS = 10_000;

const reglages = () => ({
  base: (process.env.GOCARDLESS_BASE_URL || BASE_PAR_DEFAUT).replace(/\/+$/, ""),
  secretId: process.env.GOCARDLESS_SECRET_ID || "",
  secretKey: process.env.GOCARDLESS_SECRET_KEY || "",
});

/** L'agrégation bancaire est-elle configurée sur ce déploiement ? */
export const agregationConfiguree = () => {
  const { secretId, secretKey } = reglages();
  return Boolean(secretId && secretKey);
};

/**
 * Erreur renvoyée par GoCardless, ou survenue en lui parlant.
 * `statut` est le code HTTP reçu ; 0 quand aucune réponse n'est arrivée.
 */
export class ErreurGoCardless extends Error {
  constructor(message, statut = 0) {
    super(message);
    this.name = "ErreurGoCardless";
    this.statut = statut;
  }
}

/* ─── Jeton d'accès ────────────────────────────────────────────────────────
   Valable 24 h. Gardé en mémoire le temps que vit l'instance : sur une fonction
   sans état il est simplement redemandé au réveil suivant, ce qui ne coûte
   qu'un appel. Inutile de le stocker en base pour si peu. */

let jetonEnMemoire = null; // { acces, expireLe, pour }

async function appelBrut(chemin, { methode = "GET", corps, jeton } = {}) {
  const { base } = reglages();
  let reponse;
  try {
    reponse = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: {
        Accept: "application/json",
        ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (e) {
    throw new ErreurGoCardless(`GoCardless injoignable (${e?.name ?? "erreur réseau"})`);
  }

  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    // `summary` et `detail` sont les deux champs que GoCardless renseigne.
    const motif = donnees?.summary || donnees?.detail || `HTTP ${reponse.status}`;
    throw new ErreurGoCardless(`GoCardless : ${motif}`, reponse.status);
  }
  return donnees;
}

async function jetonAcces() {
  const { secretId, secretKey } = reglages();
  if (!secretId || !secretKey) throw new ErreurGoCardless("Agrégation bancaire non configurée");

  // Marge d'une minute : un jeton qui expire pendant l'appel ne sert à rien.
  if (jetonEnMemoire && jetonEnMemoire.pour === secretId && jetonEnMemoire.expireLe > Date.now() + 60_000) {
    return jetonEnMemoire.acces;
  }
  const r = await appelBrut("/token/new/", { methode: "POST", corps: { secret_id: secretId, secret_key: secretKey } });
  jetonEnMemoire = { acces: r.access, expireLe: Date.now() + (r.access_expires ?? 0) * 1000, pour: secretId };
  return r.access;
}

async function appel(chemin, options = {}) {
  try {
    return await appelBrut(chemin, { ...options, jeton: await jetonAcces() });
  } catch (e) {
    // Jeton révoqué avant son terme : on l'oublie et on retente une seule fois.
    if (e instanceof ErreurGoCardless && e.statut === 401 && jetonEnMemoire) {
      jetonEnMemoire = null;
      return appelBrut(chemin, { ...options, jeton: await jetonAcces() });
    }
    throw e;
  }
}

/** Oublie le jeton gardé en mémoire. Sert aux tests. */
export const oublierJeton = () => {
  jetonEnMemoire = null;
};

/* ─── Opérations ───────────────────────────────────────────────────────── */

/** Les banques proposées pour un pays (code ISO à deux lettres). */
export async function listerInstitutions(pays = "FR") {
  const liste = await appel(`/institutions/?country=${encodeURIComponent(pays.toLowerCase())}`);
  return (Array.isArray(liste) ? liste : [])
    .map((i) => ({ id: i.id, nom: i.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Ouvre une demande de consentement.
 * @returns {{ id: string, lien: string }} l'identifiant à conserver, et
 *   l'adresse vers laquelle envoyer l'utilisateur pour s'authentifier.
 */
export async function creerRequisition({ institutionId, redirection, reference }) {
  const r = await appel("/requisitions/", {
    methode: "POST",
    corps: { redirect: redirection, institution_id: institutionId, reference, user_language: "FR" },
  });
  return { id: r.id, lien: r.link };
}

/**
 * État d'une demande de consentement.
 * `statut` vaut « LN » une fois les comptes reliés ; « RJ » si refusée,
 * « EX » si expirée, et divers états intermédiaires entre-temps.
 */
export async function lireRequisition(id) {
  const r = await appel(`/requisitions/${encodeURIComponent(id)}/`);
  return { statut: r.status, comptes: Array.isArray(r.accounts) ? r.accounts : [] };
}

/** Retire le consentement. Une demande déjà disparue n'est pas une erreur. */
export async function supprimerRequisition(id) {
  try {
    await appel(`/requisitions/${encodeURIComponent(id)}/`, { methode: "DELETE" });
  } catch (e) {
    if (!(e instanceof ErreurGoCardless && e.statut === 404)) throw e;
  }
}

/** Soldes d'un compte, tels que la banque les publie. */
export async function lireSoldes(compteId) {
  const r = await appel(`/accounts/${encodeURIComponent(compteId)}/balances/`);
  return Array.isArray(r?.balances) ? r.balances : [];
}

/** Opérations comptabilisées d'un compte entre deux dates (AAAA-MM-JJ, incluses). */
export async function lireTransactions(compteId, du, au) {
  const r = await appel(
    `/accounts/${encodeURIComponent(compteId)}/transactions/?date_from=${du}&date_to=${au}`,
  );
  return Array.isArray(r?.transactions?.booked) ? r.transactions.booked : [];
}
