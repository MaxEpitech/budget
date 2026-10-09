// Les prestataires bancaires, derrière une même façade.
//
// GoCardless et Enable Banking rendent le même service — lire un compte après
// accord donné chez la banque — avec des parcours différents. Les routes ne
// veulent pas le savoir : elles choisissent la façade d'après les identifiants
// du foyer (`identifiants.fournisseur`), puis appellent toujours les mêmes
// fonctions.
//
// Chaque façade expose :
//   nom                          tel qu'on l'écrit à l'écran
//   redirection(app)             adresse de retour après le passage chez la banque
//   verifier(ident, app)         lève ErreurBanque si refusés ; renvoie un avertissement ou null
//   listerBanques(ident, pays)   → [{ id, nom }]
//   ouvrir(ident, { banque, app }) → { lien, colonnes } — colonnes à poser sur le compte
//   confirmer(ident, u, retour)  → { etat: "reliee" | "attente" | "refusee", colonnes?, raison? }
//   revoquer(ident, u)           retire le consentement chez le prestataire
//   lire(ident, u, du, au)       → { operations, soldes } sous la forme commune
//   reliee(u) / enAttente(u)     où en est la liaison d'un compte
import { randomUUID } from "node:crypto";
import * as gc from "./gocardless.js";
import * as eb from "./enablebanking.js";
import { ErreurBanque } from "./erreurs.js";
import { fabriquerSecret } from "../auth/secrets.js";

/** Toutes les colonnes de liaison d'un compte, remises à zéro. */
export const LIAISON_VIDE = {
  agregationActive: false,
  goCardlessRequisitionId: null,
  goCardlessAccountId: null,
  enableBankingEtat: null,
  enableBankingSessionId: null,
  enableBankingAccountId: null,
  agregationSynthese: null,
  agregationSynchroLe: null,
};

/* ─── GoCardless ───────────────────────────────────────────────────────── */

const gocardless = {
  nom: "GoCardless",
  redirection: (app) => `${app}/?banque=retour`,

  async verifier(identifiants) {
    await gc.verifierIdentifiants(identifiants);
    return null;
  },

  listerBanques: (identifiants, pays) => gc.listerInstitutions(identifiants, pays),

  async ouvrir(identifiants, { banque, app }) {
    const requisition = await gc.creerRequisition(identifiants, {
      institutionId: banque,
      redirection: this.redirection(app),
      // GoCardless exige une référence unique par demande ; elle ne sert à rien
      // d'autre, d'où un simple identifiant aléatoire.
      reference: randomUUID(),
    });
    return { lien: requisition.lien, colonnes: { goCardlessRequisitionId: requisition.id } };
  },

  async confirmer(identifiants, u) {
    const requisition = await gc.lireRequisition(identifiants, u.goCardlessRequisitionId);
    if (requisition.statut === "LN" && requisition.comptes.length > 0) {
      // Le premier compte fait office de compte principal.
      return { etat: "reliee", colonnes: { goCardlessAccountId: requisition.comptes[0] } };
    }
    // Refusée ou expirée : elle n'aboutira plus.
    if (requisition.statut === "RJ" || requisition.statut === "EX") return { etat: "refusee" };
    return { etat: "attente" };
  },

  async revoquer(identifiants, u) {
    if (u.goCardlessRequisitionId) await gc.supprimerRequisition(identifiants, u.goCardlessRequisitionId);
  },

  async lire(identifiants, u, du, au) {
    const [operations, soldes] = await Promise.all([
      gc.lireTransactions(identifiants, u.goCardlessAccountId, du, au),
      gc.lireSoldes(identifiants, u.goCardlessAccountId),
    ]);
    return { operations, soldes };
  },

  reliee: (u) => Boolean(u.goCardlessAccountId),
  enAttente: (u) => Boolean(u.goCardlessRequisitionId && !u.goCardlessAccountId),
};

/* ─── Enable Banking ───────────────────────────────────────────────────── */

// Durée d'accès demandée à la banque. Elle peut accorder moins : la session
// expire alors plus tôt, et il suffit de relier de nouveau.
const VALIDITE_JOURS = 90;

const enablebanking = {
  nom: "Enable Banking",
  // Un chemin, sans paramètre : Enable Banking exige que l'adresse de retour
  // soit déclarée telle quelle dans l'application, et y ajoute `code` et `state`.
  redirection: (app) => `${app}/banque/retour`,

  async verifier(identifiants, app) {
    const defaut = eb.defautDeLaCle(identifiants.clePrivee);
    if (defaut) throw new ErreurBanque(defaut, 401, "CLE_ILLISIBLE");

    const application = await eb.lireApplication(identifiants);
    const attendue = this.redirection(app);
    if (!application.redirections.includes(attendue)) {
      return `Identifiants valides, mais l'adresse de retour ${attendue} n'est pas déclarée dans votre application Enable Banking : ajoutez-la à ses « redirect URLs », sinon la connexion à la banque échouera.`;
    }
    if (!application.active) {
      return "Identifiants valides, mais l'application Enable Banking n'est pas encore active : en mode restreint, liez d'abord vos comptes bancaires à l'application dans le panneau Enable Banking.";
    }
    return null;
  },

  listerBanques: (identifiants, pays) => eb.listerBanques(identifiants, pays),

  async ouvrir(identifiants, { banque, app }) {
    const aspsp = eb.lireIdBanque(banque);
    if (!aspsp) throw new ErreurBanque("Banque inconnue", 400);
    const etat = fabriquerSecret();
    const { lien } = await eb.ouvrirAutorisation(identifiants, {
      banque: aspsp,
      redirection: this.redirection(app),
      etat,
      validiteJours: VALIDITE_JOURS,
    });
    return { lien, colonnes: { enableBankingEtat: etat } };
  },

  async confirmer(identifiants, u, retour) {
    // L'utilisateur a refusé chez sa banque, ou celle-ci a renvoyé une erreur.
    if (retour.erreur) return { etat: "refusee" };
    // Revenu sans code : onglet refermé en chemin. Rien à confirmer encore.
    if (!retour.code) return { etat: "attente" };
    // Le retour doit répondre à la demande ouverte par CE compte : sans cette
    // vérification, un lien forgé pourrait faire relier le compte d'un tiers.
    if (!retour.etat || retour.etat !== u.enableBankingEtat) return { etat: "attente", raison: "retour-inattendu" };

    const session = await eb.creerSession(identifiants, retour.code);
    if (session.comptes.length === 0) {
      // En mode restreint, Enable Banking retire de la réponse tout compte qui
      // n'a pas été lié à l'application dans son panneau.
      await eb.supprimerSession(identifiants, session.sessionId).catch(() => {});
      return { etat: "refusee", raison: "aucun-compte" };
    }
    return {
      etat: "reliee",
      // Le premier compte fait office de compte principal.
      colonnes: { enableBankingEtat: null, enableBankingSessionId: session.sessionId, enableBankingAccountId: session.comptes[0] },
    };
  },

  async revoquer(identifiants, u) {
    if (u.enableBankingSessionId) await eb.supprimerSession(identifiants, u.enableBankingSessionId);
  },

  async lire(identifiants, u, du, au) {
    const [operations, soldes] = await Promise.all([
      eb.lireTransactions(identifiants, u.enableBankingAccountId, du, au),
      eb.lireSoldes(identifiants, u.enableBankingAccountId),
    ]);
    return { operations, soldes };
  },

  reliee: (u) => Boolean(u.enableBankingAccountId),
  enAttente: (u) => Boolean(u.enableBankingEtat && !u.enableBankingAccountId),
};

export const FOURNISSEURS = { gocardless, enablebanking };

/** La façade correspondant à des identifiants, ou null s'il n'y en a pas. */
export const fournisseurDe = (identifiants) => (identifiants ? FOURNISSEURS[identifiants.fournisseur] ?? null : null);
