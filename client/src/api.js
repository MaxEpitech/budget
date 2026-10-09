// Client API — l'unique point de couplage avec le serveur.
// Remplace l'objet `source` du prototype : mêmes données, mais servies par
// Express/Postgres au lieu du stockage navigateur.

/**
 * @param options.persistant  Demande au navigateur de mener la requête à son
 *   terme même si la page se ferme. Sert aux envois de dernière seconde : un
 *   fetch ordinaire serait abandonné avec l'onglet, et la saisie perdue.
 */
async function requete(chemin, methode = "GET", corps, options = {}) {
  let reponse;
  try {
    reponse = await fetch(`/api${chemin}`, {
      method: methode,
      headers: corps !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      // Le cookie de session accompagne chaque appel.
      credentials: "same-origin",
      keepalive: options.persistant === true,
    });
  } catch {
    throw new Error("Serveur injoignable — l'API est-elle démarrée ?");
  }
  if (!reponse.ok) {
    let message = `Erreur ${reponse.status}`;
    let motif;
    try {
      const donnees = await reponse.json();
      if (donnees.erreur) message = donnees.erreur;
      motif = donnees.motif;
    } catch {
      // réponse sans corps JSON : on garde le code HTTP
    }
    const erreur = new Error(message);
    erreur.statut = reponse.status;
    erreur.motif = motif;
    // Permet à l'application de renvoyer vers la connexion quand la session tombe.
    erreur.nonAutorise = reponse.status === 401 || reponse.status === 403;
    throw erreur;
  }
  if (reponse.status === 204) return null;
  try {
    return await reponse.json();
  } catch {
    // Sans quoi l'utilisateur lirait le message anglais du navigateur (« Unexpected token… »).
    throw new Error("Réponse du serveur illisible. Réessayez dans un instant.");
  }
}

export const api = {
  /* ─── Compte ─── */
  moi: () => requete("/auth/moi"),
  inscription: (email, motDePasse) => requete("/auth/inscription", "POST", { email, motDePasse }),
  connexion: (email, motDePasse) => requete("/auth/connexion", "POST", { email, motDePasse }),
  deconnexion: () => requete("/auth/deconnexion", "POST"),
  validerEmail: (jeton) => requete("/auth/validation", "POST", { jeton }),
  renvoyerValidation: (email) => requete("/auth/renvoyer-validation", "POST", { email }),
  motDePasseOublie: (email) => requete("/auth/mot-de-passe-oublie", "POST", { email }),
  reinitialiser: (jeton, motDePasse) => requete("/auth/reinitialiser", "POST", { jeton, motDePasse }),
  mesDonnees: () => requete("/auth/mes-donnees"),
  supprimerCompte: (motDePasse) => requete("/auth/moi", "DELETE", { motDePasse }),
  sessions: () => requete("/auth/sessions"),
  fermerSession: (id) => requete(`/auth/sessions/${id}`, "DELETE"),

  /* ─── Budget ─── */
  etat: (mois) => requete(`/etat?mois=${encodeURIComponent(mois)}`),
  historique: (jusqu, mois = 12) => requete(`/historique?jusqu=${encodeURIComponent(jusqu)}&mois=${mois}`),

  transactions: () => requete("/transactions"),
  creerTransaction: (t) => requete("/transactions", "POST", t),
  supprimerTransaction: (id, options) => requete(`/transactions/${id}`, "DELETE", undefined, options),
  // Opérations d'un relevé, validées dans l'aperçu ; `lot` permet d'annuler l'import.
  importerTransactions: (pour, operations) => requete("/transactions/import", "POST", { pour, operations }),
  annulerImport: (lot) => requete(`/transactions/import/${encodeURIComponent(lot)}`, "DELETE"),

  credits: () => requete("/credits"),
  creerCredit: (c) => requete("/credits", "POST", c),
  modifierCredit: (id, credit) => requete(`/credits/${id}`, "PUT", credit),
  supprimerCredit: (id, options) => requete(`/credits/${id}`, "DELETE", undefined, options),
  // Une échéance réellement prélevée ; `reperes` : { date, libelle }, facultatifs.
  payerCredit: (id, montant, pour = "foyer", reperes = {}) => requete(`/credits/${id}/paiements`, "POST", { montant, pour, ...reperes }),
  supprimerPaiement: (creditId, paiementId) => requete(`/credits/${creditId}/paiements/${paiementId}`, "DELETE"),

  projets: () => requete("/projets"),
  creerProjet: (p) => requete("/projets", "POST", p),
  modifierProjet: (id, patch, options) => requete(`/projets/${id}`, "PUT", patch, options),
  supprimerProjet: (id, options) => requete(`/projets/${id}`, "DELETE", undefined, options),
  verser: (id, montant, pour = "foyer", reperes = {}) => requete(`/projets/${id}/versements`, "POST", { montant, pour, ...reperes }),
  supprimerVersement: (projetId, versementId) => requete(`/projets/${projetId}/versements/${versementId}`, "DELETE"),

  placements: () => requete("/placements"),
  creerPlacement: (p) => requete("/placements", "POST", p),
  modifierPlacement: (id, patch, options) => requete(`/placements/${id}`, "PUT", patch, options),
  supprimerPlacement: (id, options) => requete(`/placements/${id}`, "DELETE", undefined, options),
  mouvementer: (id, type, montant, pour = "foyer", reperes = {}) => requete(`/placements/${id}/mouvements`, "POST", { type, montant, pour, ...reperes }),
  supprimerMouvement: (placementId, mouvementId) => requete(`/placements/${placementId}/mouvements/${mouvementId}`, "DELETE"),

  membres: () => requete("/membres"),
  creerMembre: (m) => requete("/membres", "POST", m),
  modifierMembre: (id, patch, options) => requete(`/membres/${id}`, "PUT", patch, options),
  supprimerMembre: (id) => requete(`/membres/${id}`, "DELETE"),

  budgets: () => requete("/budgets"),
  definirBudget: (categorie, montant) => requete("/budgets", "PUT", { categorie, montant }),
  supprimerBudget: (id) => requete(`/budgets/${id}`, "DELETE"),

  modifierFoyer: (repartition) => requete("/foyer", "PUT", { repartition }),

  /* ─── Synchronisation bancaire ───
     Aucune de ces routes ne prend d'identifiant de compte : le serveur ne
     connaît que celui de la session. */
  // Identifiants du foyer chez son prestataire : le secret part, mais ne revient jamais.
  banqueConfiguration: () => requete("/banque/configuration"),
  banqueConfigurer: (identifiants) => requete("/banque/configuration", "PUT", identifiants),
  banqueDeconfigurer: () => requete("/banque/configuration", "DELETE"),
  // Relevé téléchargé depuis la banque : lu et analysé, jamais enregistré tel quel.
  // Un classeur (.xlsx) voyage en base64 (`encodage`), le reste en texte.
  banqueReleve: (nom, contenu, pour = "foyer", encodage = "texte") => requete("/banque/releve", "POST", { nom, contenu, pour, encodage }),
  banqueStatut: () => requete("/banque/statut"),
  banqueInstitutions: (pays = "FR") => requete(`/banque/institutions?pays=${encodeURIComponent(pays)}`),
  banqueInitier: (institutionId) => requete("/banque/initiate", "POST", { institutionId }),
  // `retour` : ce que la banque a ajouté à l'adresse de retour (code, state, error).
  banqueConfirmer: (retour = {}) => {
    const params = new URLSearchParams(Object.entries(retour).filter(([, v]) => v));
    return requete(`/banque/callback${params.size ? `?${params}` : ""}`);
  },
  banqueActiver: (active) => requete("/banque", "PUT", { active }),
  banqueDonnees: () => requete("/banque/financial-data"),
  banqueDissocier: () => requete("/banque", "DELETE"),

  /* ─── Foyer partagé ─── */
  acces: () => requete("/foyer/acces"),
  inviter: (email, role, membreId) => requete("/foyer/invitations", "POST", { email, role, membreId }),
  revoquerInvitation: (id) => requete(`/foyer/invitations/${id}`, "DELETE"),
  changerRole: (id, role) => requete(`/foyer/acces/${id}`, "PUT", { role }),
  retirerAcces: (id) => requete(`/foyer/acces/${id}`, "DELETE"),
  lireInvitation: (jeton) => requete(`/auth/invitation?jeton=${encodeURIComponent(jeton)}`),
  accepterInvitation: (jeton, motDePasse) => requete("/auth/invitation", "POST", { jeton, motDePasse }),
};
