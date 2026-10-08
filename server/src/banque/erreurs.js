// Erreur commune aux prestataires bancaires.
//
// Les routes ne connaissent qu'elle : qu'un appel ait échoué chez GoCardless ou
// chez Enable Banking, la réponse à l'utilisateur est la même.

/**
 * Erreur renvoyée par un prestataire bancaire, ou survenue en lui parlant.
 * `statut` est le code HTTP reçu ; 0 quand aucune réponse n'est arrivée.
 * `code` est le code d'erreur propre au prestataire, quand il en donne un.
 */
export class ErreurBanque extends Error {
  constructor(message, statut = 0, code = null) {
    super(message);
    this.name = "ErreurBanque";
    this.statut = statut;
    this.code = code;
  }
}

/** Les identifiants eux-mêmes sont refusés, ou inutilisables. */
export const identifiantsRefuses = (e) => e instanceof ErreurBanque && (e.statut === 401 || e.statut === 403);
