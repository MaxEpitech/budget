// Client de l'API GoCardless Bank Account Data (ex-Nordigen).
//
// Seul fichier qui parle à GoCardless : les routes n'en connaissent que les
// fonctions exportées ici. Pas de dépendance — le `fetch` de Node suffit.
//
// ─── Identifiants ─────────────────────────────────────────────────────────
// Chaque fonction reçoit en premier les identifiants à utiliser
// (`{ secretId, secretKey }`) : ils dépendent du foyer, voir identifiants.js.
// Ce fichier ne sait pas d'où ils viennent, et ne les journalise jamais.
//
// GOCARDLESS_BASE_URL : à ne changer que pour viser un faux serveur en test.

const BASE_PAR_DEFAUT = "https://bankaccountdata.gocardless.com/api/v2";

// La fonction Vercel est coupée à 15 s : mieux vaut renoncer avant, et répondre
// une erreur lisible, que laisser l'hébergeur tuer la requête.
const DELAI_MS = 10_000;

const base = () => (process.env.GOCARDLESS_BASE_URL || BASE_PAR_DEFAUT).replace(/\/+$/, "");

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
   qu'un appel. Inutile de le stocker en base pour si peu.
   Un jeton par jeu d'identifiants : deux foyers n'ont pas le même compte. */

const jetons = new Map(); // secretId → { acces, expireLe, secretKey }

async function appelBrut(chemin, { methode = "GET", corps, jeton } = {}) {
  let reponse;
  try {
    reponse = await fetch(`${base()}${chemin}`, {
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

async function jetonAcces(identifiants) {
  const { secretId, secretKey } = identifiants ?? {};
  if (!secretId || !secretKey) throw new ErreurGoCardless("Agrégation bancaire non configurée");

  // Marge d'une minute : un jeton qui expire pendant l'appel ne sert à rien.
  // La clé est comparée aussi : après un changement de clé, l'ancien jeton ne
  // doit pas faire passer la nouvelle pour valide.
  const connu = jetons.get(secretId);
  if (connu && connu.secretKey === secretKey && connu.expireLe > Date.now() + 60_000) return connu.acces;

  const r = await appelBrut("/token/new/", { methode: "POST", corps: { secret_id: secretId, secret_key: secretKey } });
  jetons.set(secretId, { acces: r.access, expireLe: Date.now() + (r.access_expires ?? 0) * 1000, secretKey });
  return r.access;
}

async function appel(identifiants, chemin, options = {}) {
  try {
    return await appelBrut(chemin, { ...options, jeton: await jetonAcces(identifiants) });
  } catch (e) {
    // Jeton révoqué avant son terme : on l'oublie et on retente une seule fois.
    if (e instanceof ErreurGoCardless && e.statut === 401 && jetons.delete(identifiants?.secretId)) {
      return appelBrut(chemin, { ...options, jeton: await jetonAcces(identifiants) });
    }
    throw e;
  }
}

/**
 * Vérifie des identifiants en demandant un jeton neuf, sans rien mettre en
 * mémoire tant qu'ils ne sont pas acceptés. Lève ErreurGoCardless sinon.
 */
export async function verifierIdentifiants(identifiants) {
  jetons.delete(identifiants?.secretId);
  await jetonAcces(identifiants);
}

/* ─── Opérations ───────────────────────────────────────────────────────── */

/** Les banques proposées pour un pays (code ISO à deux lettres). */
export async function listerInstitutions(identifiants, pays = "FR") {
  const liste = await appel(identifiants, `/institutions/?country=${encodeURIComponent(pays.toLowerCase())}`);
  return (Array.isArray(liste) ? liste : [])
    .map((i) => ({ id: i.id, nom: i.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Ouvre une demande de consentement.
 * @returns {{ id: string, lien: string }} l'identifiant à conserver, et
 *   l'adresse vers laquelle envoyer l'utilisateur pour s'authentifier.
 */
export async function creerRequisition(identifiants, { institutionId, redirection, reference }) {
  const r = await appel(identifiants, "/requisitions/", {
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
export async function lireRequisition(identifiants, id) {
  const r = await appel(identifiants, `/requisitions/${encodeURIComponent(id)}/`);
  return { statut: r.status, comptes: Array.isArray(r.accounts) ? r.accounts : [] };
}

/** Retire le consentement. Une demande déjà disparue n'est pas une erreur. */
export async function supprimerRequisition(identifiants, id) {
  try {
    await appel(identifiants, `/requisitions/${encodeURIComponent(id)}/`, { methode: "DELETE" });
  } catch (e) {
    if (!(e instanceof ErreurGoCardless && e.statut === 404)) throw e;
  }
}

/** Soldes d'un compte, tels que la banque les publie. */
export async function lireSoldes(identifiants, compteId) {
  const r = await appel(identifiants, `/accounts/${encodeURIComponent(compteId)}/balances/`);
  return Array.isArray(r?.balances) ? r.balances : [];
}

/** Opérations comptabilisées d'un compte entre deux dates (AAAA-MM-JJ, incluses). */
export async function lireTransactions(identifiants, compteId, du, au) {
  const r = await appel(
    identifiants,
    `/accounts/${encodeURIComponent(compteId)}/transactions/?date_from=${du}&date_to=${au}`,
  );
  return Array.isArray(r?.transactions?.booked) ? r.transactions.booked : [];
}
