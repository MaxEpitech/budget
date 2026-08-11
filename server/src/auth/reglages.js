// Réglages du module d'authentification.

/**
 * Faut-il confirmer son adresse avant de pouvoir se servir de son compte ?
 *
 * Par défaut non : tant qu'aucun service d'envoi n'est branché, exiger la
 * confirmation reviendrait à rendre l'inscription inutilisable — le lien
 * n'arriverait nulle part. L'inscription ouvre donc directement la session.
 *
 * Passer CONFIRMATION_EMAIL_REQUISE à 1 dans le .env rétablit le parcours
 * complet (email de confirmation, connexion refusée tant qu'elle n'a pas eu
 * lieu). Tout le circuit reste en place, seul ce réglage change.
 */
export const confirmationEmailRequise = () =>
  ["1", "true", "oui"].includes(String(process.env.CONFIRMATION_EMAIL_REQUISE ?? "").toLowerCase());
