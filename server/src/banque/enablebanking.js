// Client de l'API Enable Banking (agrégation de comptes, DSP2).
//
// Seul fichier qui parle à Enable Banking. Pas de dépendance : le `fetch` et le
// module `crypto` de Node suffisent, y compris pour signer le jeton.
//
// ─── Identifiants ─────────────────────────────────────────────────────────
// Une application Enable Banking est désignée par son identifiant (`appId`) et
// prouve qui elle est en signant un jeton avec sa clé privée (`clePrivee`, au
// format PEM). Il n'y a pas de secret partagé, ni de jeton à aller chercher :
// chaque requête porte un jeton signé sur place.
//
// ENABLEBANKING_BASE_URL : à ne changer que pour viser un faux serveur en test.
import { createPrivateKey, createSign } from "node:crypto";
import { ErreurBanque } from "./erreurs.js";

const BASE_PAR_DEFAUT = "https://api.enablebanking.com";
const DELAI_MS = 10_000;

// Durée de vie du jeton signé. Une heure : il ne sert qu'à la requête en cours,
// et Enable Banking refuse tout jeton de plus de 24 h.
const VIE_JETON_S = 3600;

// Garde-fou de pagination : 90 jours d'opérations tiennent en quelques pages.
const PAGES_MAXIMUM = 20;

const base = () => (process.env.ENABLEBANKING_BASE_URL || BASE_PAR_DEFAUT).replace(/\/+$/, "");

const enBase64Url = (objet) => Buffer.from(JSON.stringify(objet)).toString("base64url");

/**
 * La clé privée est-elle lisible et du bon type ? Renvoie un message d'erreur,
 * ou null si elle convient. Vérifié avant tout appel : une clé illisible ferait
 * sinon échouer la signature avec une erreur de bibliothèque, pas un message.
 */
export function defautDeLaCle(clePrivee) {
  try {
    const cle = createPrivateKey(String(clePrivee ?? ""));
    return cle.asymmetricKeyType === "rsa" ? null : "La clé privée n'est pas une clé RSA.";
  } catch {
    return "La clé privée est illisible : collez le contenu complet du fichier .pem, lignes BEGIN et END comprises.";
  }
}

/** Jeton signé (RS256) présenté à chaque requête. */
export function signerJeton({ appId, clePrivee }, maintenant = Date.now()) {
  const iat = Math.floor(maintenant / 1000);
  const entete = enBase64Url({ typ: "JWT", alg: "RS256", kid: appId });
  const corps = enBase64Url({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + VIE_JETON_S });
  const signature = createSign("RSA-SHA256").update(`${entete}.${corps}`).sign(clePrivee).toString("base64url");
  return `${entete}.${corps}.${signature}`;
}

async function appel(identifiants, chemin, { methode = "GET", corps } = {}) {
  if (!identifiants?.appId || !identifiants.clePrivee) throw new ErreurBanque("Enable Banking non configuré");

  let jeton;
  try {
    jeton = signerJeton(identifiants);
  } catch {
    // Traité comme un refus d'identifiants : c'est bien ce que c'est.
    throw new ErreurBanque("Enable Banking : clé privée inutilisable", 401);
  }

  let reponse;
  try {
    reponse = await fetch(`${base()}${chemin}`, {
      method: methode,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${jeton}`,
        ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      signal: AbortSignal.timeout(DELAI_MS),
    });
  } catch (e) {
    throw new ErreurBanque(`Enable Banking injoignable (${e?.name ?? "erreur réseau"})`);
  }

  const donnees = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    // `error` porte le code métier (EXPIRED_SESSION, ASPSP_RATE_LIMIT_EXCEEDED…).
    const code = typeof donnees?.error === "string" ? donnees.error : null;
    const motif = donnees?.message || code || `HTTP ${reponse.status}`;
    throw new ErreurBanque(`Enable Banking : ${motif}`, reponse.status, code);
  }
  return donnees;
}

/* ─── Opérations ───────────────────────────────────────────────────────── */

/**
 * Ce qu'Enable Banking sait de l'application : sert à vérifier les identifiants,
 * et à prévenir quand l'adresse de retour n'y est pas déclarée.
 */
export async function lireApplication(identifiants) {
  const a = await appel(identifiants, "/application");
  return {
    nom: a?.name ?? null,
    active: a?.active !== false,
    environnement: a?.environment ?? null,
    redirections: Array.isArray(a?.redirect_urls) ? a.redirect_urls : [],
  };
}

// Une banque est désignée chez Enable Banking par son nom ET son pays. Les deux
// voyagent dans un seul identifiant, « FR:Nom de la banque ».
const idBanque = (aspsp) => `${aspsp.country}:${aspsp.name}`;

export function lireIdBanque(id) {
  const coupe = String(id ?? "").indexOf(":");
  if (coupe !== 2) return null;
  const nom = id.slice(3).trim();
  return nom ? { country: id.slice(0, 2).toUpperCase(), name: nom } : null;
}

/** Les banques proposées aux particuliers pour un pays (code ISO à deux lettres). */
export async function listerBanques(identifiants, pays = "FR") {
  const r = await appel(identifiants, `/aspsps?country=${encodeURIComponent(pays.toUpperCase())}&psu_type=personal`);
  return (Array.isArray(r?.aspsps) ? r.aspsps : [])
    .map((a) => ({ id: idBanque(a), nom: a.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Ouvre une demande d'accès.
 * @param etat valeur aléatoire renvoyée telle quelle au retour : elle prouve que
 *   le retour répond bien à CETTE demande.
 * @returns {{ lien: string }} l'adresse où l'utilisateur s'authentifie
 */
export async function ouvrirAutorisation(identifiants, { banque, redirection, etat, validiteJours }) {
  const r = await appel(identifiants, "/auth", {
    methode: "POST",
    corps: {
      access: { valid_until: new Date(Date.now() + validiteJours * 24 * 60 * 60 * 1000).toISOString() },
      aspsp: banque,
      state: etat,
      redirect_url: redirection,
      psu_type: "personal",
      language: "fr",
    },
  });
  return { lien: r.url };
}

/** Échange le code reçu au retour contre une session et ses comptes. */
export async function creerSession(identifiants, code) {
  const r = await appel(identifiants, "/sessions", { methode: "POST", corps: { code } });
  return {
    sessionId: r.session_id,
    comptes: (Array.isArray(r.accounts) ? r.accounts : []).map((c) => c?.uid).filter(Boolean),
  };
}

/** Ferme la session, et le consentement chez la banque quand c'est possible. */
export async function supprimerSession(identifiants, sessionId) {
  try {
    await appel(identifiants, `/sessions/${encodeURIComponent(sessionId)}`, { methode: "DELETE" });
  } catch (e) {
    if (!(e instanceof ErreurBanque && e.statut === 404)) throw e;
  }
}

// Codes ISO 20022 → noms qu'emploie le reste de l'application.
const TYPES_SOLDE = { CLBD: "closingBooked", ITBD: "interimBooked", XPCD: "expected", ITAV: "interimAvailable", CLAV: "closingAvailable" };

/** Soldes d'un compte, ramenés à la forme commune aux prestataires. */
export async function lireSoldes(identifiants, compteId) {
  const r = await appel(identifiants, `/accounts/${encodeURIComponent(compteId)}/balances`);
  return (Array.isArray(r?.balances) ? r.balances : []).map((s) => ({
    balanceType: TYPES_SOLDE[s?.balance_type] ?? s?.balance_type ?? null,
    balanceAmount: { amount: s?.balance_amount?.amount, currency: s?.balance_amount?.currency },
  }));
}

/**
 * Ramène une opération Enable Banking à la forme commune.
 *
 * Enable Banking donne un montant sans signe et un sens (crédit ou débit) ;
 * l'analyse attend un montant signé, comme GoCardless le fournit.
 */
export function normaliserOperation(t) {
  const brut = String(t?.transaction_amount?.amount ?? "").trim().replace(/^[+-]/, "");
  return {
    bookingDate: t?.booking_date ?? t?.value_date ?? t?.transaction_date ?? null,
    transactionAmount: { amount: t?.credit_debit_indicator === "DBIT" ? `-${brut}` : brut, currency: t?.transaction_amount?.currency },
    remittanceInformationUnstructuredArray: Array.isArray(t?.remittance_information) ? t.remittance_information : [],
    additionalInformation: t?.note ?? null,
    creditorName: t?.creditor?.name ?? null,
    debtorName: t?.debtor?.name ?? null,
  };
}

/** Opérations comptabilisées d'un compte entre deux dates (AAAA-MM-JJ, incluses). */
export async function lireTransactions(identifiants, compteId, du, au) {
  const operations = [];
  let suite = null;
  for (let page = 0; page < PAGES_MAXIMUM; page++) {
    const r = await appel(
      identifiants,
      `/accounts/${encodeURIComponent(compteId)}/transactions?date_from=${du}&date_to=${au}` +
        (suite ? `&continuation_key=${encodeURIComponent(suite)}` : ""),
    );
    for (const t of Array.isArray(r?.transactions) ? r.transactions : []) {
      // Les opérations en attente peuvent encore changer, ou disparaître.
      if (!t?.status || t.status === "BOOK") operations.push(normaliserOperation(t));
    }
    suite = r?.continuation_key || null;
    if (!suite) break;
  }
  return operations;
}
