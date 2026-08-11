// Client API — l'unique point de couplage avec le serveur.
// Remplace l'objet `source` du prototype : mêmes données, mais servies par
// Express/Postgres au lieu du stockage navigateur.

async function requete(chemin, methode = "GET", corps) {
  let reponse;
  try {
    reponse = await fetch(`/api${chemin}`, {
      method: methode,
      headers: corps !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
      // Le cookie de session accompagne chaque appel.
      credentials: "same-origin",
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
  return reponse.status === 204 ? null : reponse.json();
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

  /* ─── Budget ─── */
  etat: (mois) => requete(`/etat?mois=${encodeURIComponent(mois)}`),

  transactions: () => requete("/transactions"),
  creerTransaction: (t) => requete("/transactions", "POST", t),
  supprimerTransaction: (id) => requete(`/transactions/${id}`, "DELETE"),

  credits: () => requete("/credits"),
  creerCredit: (c) => requete("/credits", "POST", c),
  supprimerCredit: (id) => requete(`/credits/${id}`, "DELETE"),

  projets: () => requete("/projets"),
  creerProjet: (p) => requete("/projets", "POST", p),
  modifierProjet: (id, patch) => requete(`/projets/${id}`, "PUT", patch),
  supprimerProjet: (id) => requete(`/projets/${id}`, "DELETE"),
  verser: (id, montant, pour = "foyer") => requete(`/projets/${id}/versements`, "POST", { montant, pour }),

  placements: () => requete("/placements"),
  creerPlacement: (p) => requete("/placements", "POST", p),
  modifierPlacement: (id, patch) => requete(`/placements/${id}`, "PUT", patch),
  supprimerPlacement: (id) => requete(`/placements/${id}`, "DELETE"),

  membres: () => requete("/membres"),
  creerMembre: (m) => requete("/membres", "POST", m),
  modifierMembre: (id, patch) => requete(`/membres/${id}`, "PUT", patch),
  supprimerMembre: (id) => requete(`/membres/${id}`, "DELETE"),

  modifierFoyer: (repartition) => requete("/foyer", "PUT", { repartition }),
};
