// Client de l'API Bridge (agrégation de comptes, DSP2), version 2025-01-15.
//
// Seul fichier qui parle à Bridge. Pas de dépendance : le `fetch` de Node suffit.
//
// ─── Identifiants ─────────────────────────────────────────────────────────
// Une application Bridge se présente par son `clientId` et son `clientSecret`,
// envoyés à chaque requête. Ce qui touche aux données d'une personne exige en
// plus un jeton d'utilisateur (`Authorization: Bearer`), obtenu pour un
// utilisateur Bridge et valable quelques heures : on en redemande un à chaque
// usage plutôt que de le garder.
//
// ─── Modèle ───────────────────────────────────────────────────────────────
// Un « utilisateur » Bridge par compte de l'application ; il réunit les
// connexions bancaires (« items ») de la personne, et chaque item ses comptes.
// Supprimer l'utilisateur supprime tout cela, et le consentement avec.
//
// BRIDGE_BASE_URL : à ne changer que pour viser un faux serveur en test.
import { randomUUID } from "node:crypto";
import { ErreurBanque } from "./erreurs.js";

const BASE_PAR_DEFAUT = "https://api.bridgeapi.io";
const VERSION = "2025-01-15";
const DELAI_MS = 10_000;

// Garde-fou de pagination : 90 jours d'opérations tiennent en quelques pages de 500.
const PAGES_MAXIMUM = 20;

const base = () => (process.env.BRIDGE_BASE_URL || BASE_PAR_DEFAUT).replace(/\/+$/, "");

async function appel(identifiants, chemin, { methode = "GET", corps, jeton } = {}) {
  if (!identifiants?.clientId || !identifiants.clientSecret) throw new ErreurBanque("Bridge non configuré");

  let reponse;
  try {
    reponse = await fetch(`${base()}${chemin}`, {
      method: methode,
      headers: {
        Accept: "application/json",
        "Bridge-Version": VERSION,
        "Client-Id": identifiants.clientId,
        "Client-Secret": identifiants.clientSecret,
        ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}),
        ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (e) {
    throw new ErreurBanque(`Bridge injoignable (${e?.name ?? "erreur réseau"})`);
  }

  if (reponse.status === 204) return null;
  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    // `errors[0].code` porte le code métier (user.authentication.unauthorized…).
    const erreur = Array.isArray(donnees?.errors) ? donnees.errors[0] : null;
    const code = typeof erreur?.code === "string" ? erreur.code : null;
    const motif = erreur?.message || code || `HTTP ${reponse.status}`;
    throw new ErreurBanque(`Bridge : ${motif}`, reponse.status, code);
  }
  return donnees;
}

/** Toutes les pages d'une liste, en suivant `pagination.next_uri` (chemin relatif). */
async function toutesLesPages(identifiants, chemin, options) {
  const ressources = [];
  let suite = chemin;
  for (let page = 0; page < PAGES_MAXIMUM && suite; page++) {
    const r = await appel(identifiants, suite, options);
    if (Array.isArray(r?.resources)) ressources.push(...r.resources);
    const prochaine = r?.pagination?.next_uri;
    // Un chemin relatif seulement : jamais suivre une adresse vers un autre hôte.
    suite = typeof prochaine === "string" && prochaine.startsWith("/") ? prochaine : null;
  }
  return ressources;
}

/* ─── Opérations ───────────────────────────────────────────────────────── */

/**
 * Vérifie les identifiants de l'application : la liste des banques n'exige
 * qu'eux, et répond 401 s'ils sont faux.
 */
export async function verifierIdentifiants(identifiants) {
  await appel(identifiants, "/v3/providers?limit=1");
}

/** Les banques proposant l'agrégation pour un pays (code ISO à deux lettres). */
export async function listerBanques(identifiants, pays = "FR") {
  const liste = await toutesLesPages(
    identifiants,
    `/v3/providers?country_code=${encodeURIComponent(pays.toUpperCase())}&capabilities=aggregation&limit=500`,
  );
  return liste
    .filter((p) => p?.id !== undefined && p?.name)
    .map((p) => ({ id: String(p.id), nom: p.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/** Crée un utilisateur Bridge, propre à une demande de liaison. */
export async function creerUtilisateur(identifiants) {
  // Notre identifiant interne n'a rien à faire chez Bridge : une valeur
  // aléatoire suffit, et ne risque pas de heurter un utilisateur supprimé.
  const r = await appel(identifiants, "/v3/aggregation/users", { methode: "POST", corps: { external_user_id: `budget-${randomUUID()}` } });
  if (!r?.uuid) throw new ErreurBanque("Bridge : utilisateur non créé");
  return r.uuid;
}

/** Supprime l'utilisateur Bridge, ses connexions bancaires et leurs données. */
export async function supprimerUtilisateur(identifiants, userUuid) {
  try {
    await appel(identifiants, `/v3/aggregation/users/${encodeURIComponent(userUuid)}`, { methode: "DELETE" });
  } catch (e) {
    if (!(e instanceof ErreurBanque && e.statut === 404)) throw e;
  }
}

/** Jeton d'accès aux données d'un utilisateur. */
async function jetonDe(identifiants, userUuid) {
  const r = await appel(identifiants, "/v3/aggregation/authorization/token", { methode: "POST", corps: { user_uuid: userUuid } });
  if (!r?.access_token) throw new ErreurBanque("Bridge : jeton d'utilisateur non délivré", 401);
  return r.access_token;
}

/**
 * Ouvre une session Bridge Connect, où l'utilisateur choisit sa banque et s'y authentifie.
 * @param contexte valeur aléatoire renvoyée telle quelle au retour (`context`) :
 *   elle prouve que le retour répond bien à CETTE demande.
 * @returns {{ lien: string }}
 */
export async function ouvrirSession(identifiants, { userUuid, email, banque, redirection, contexte }) {
  const jeton = await jetonDe(identifiants, userUuid);
  const providerId = Number(banque);
  const r = await appel(identifiants, "/v3/aggregation/connect-sessions", {
    methode: "POST",
    jeton,
    corps: {
      user_email: email,
      callback_url: redirection,
      context: contexte,
      ...(Number.isInteger(providerId) && providerId > 0 ? { provider_id: providerId } : {}),
    },
  });
  if (!r?.url) throw new ErreurBanque("Bridge : session de connexion non ouverte");
  return { lien: r.url };
}

// Types de compte où arrivent salaire et dépenses courantes, par ordre de préférence.
const COMPTES_COURANTS = ["checking", "card"];

/**
 * Le compte à lire pour une connexion bancaire : le premier compte courant
 * dont l'accès a été accordé, ou null s'il n'y en a pas.
 *
 * Les comptes sont lus avec le jeton de l'utilisateur : un `itemId` qui ne
 * serait pas le sien ne renverrait rien.
 */
export async function choisirCompte(identifiants, userUuid, itemId) {
  const jeton = await jetonDe(identifiants, userUuid);
  const comptes = (await toutesLesPages(identifiants, `/v3/aggregation/accounts?item_id=${encodeURIComponent(itemId)}&limit=500`, { jeton }))
    .filter((c) => c?.id !== undefined && String(c.item_id) === String(itemId) && c.data_access !== "disabled");
  for (const type of COMPTES_COURANTS) {
    const trouve = comptes.find((c) => c.type === type);
    if (trouve) return String(trouve.id);
  }
  return null;
}

/** Soldes d'un compte, ramenés à la forme commune aux prestataires. */
export async function lireSoldes(identifiants, userUuid, compteId) {
  const jeton = await jetonDe(identifiants, userUuid);
  const c = await appel(identifiants, `/v3/aggregation/accounts/${encodeURIComponent(compteId)}`, { jeton });
  const monnaie = c?.currency_code;
  const solde = (type, montant) => (typeof montant === "number" ? [{ balanceType: type, balanceAmount: { amount: String(montant), currency: monnaie } }] : []);
  // `accounting_balance` exclut les opérations en cours : c'est le solde comptabilisé.
  return [...solde("closingBooked", c?.accounting_balance), ...solde("expected", c?.balance), ...solde("interimAvailable", c?.instant_balance)];
}

/**
 * Ramène une opération Bridge à la forme commune.
 *
 * Bridge donne déjà un montant signé (négatif au débit) ; seul le libellé est
 * double : celui de la banque, et celui que Bridge a nettoyé.
 */
export function normaliserOperation(t) {
  const libelles = [t?.provider_description, t?.clean_description].filter((l) => typeof l === "string" && l.trim());
  return {
    bookingDate: t?.booking_date ?? t?.date ?? t?.value_date ?? null,
    transactionAmount: { amount: typeof t?.amount === "number" ? String(t.amount) : String(t?.amount ?? ""), currency: t?.currency_code },
    remittanceInformationUnstructuredArray: [...new Set(libelles)],
    additionalInformation: null,
    creditorName: null,
    debtorName: null,
  };
}

/** Opérations comptabilisées d'un compte entre deux dates (AAAA-MM-JJ, incluses). */
export async function lireTransactions(identifiants, userUuid, compteId, du, au) {
  const jeton = await jetonDe(identifiants, userUuid);
  const liste = await toutesLesPages(
    identifiants,
    `/v3/aggregation/transactions?account_id=${encodeURIComponent(compteId)}&min_date=${du}&max_date=${au}&limit=500`,
    { jeton },
  );
  return liste
    // Supprimées, ou à venir (débit différé) : elles ne disent rien du passé.
    .filter((t) => t && !t.deleted && !t.future && String(t.account_id ?? compteId) === String(compteId))
    .map(normaliserOperation);
}
