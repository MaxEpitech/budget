// Client HTTP qui retient les cookies, comme le ferait un navigateur.
//
// Les tests d'intégration parlent à l'API par le réseau plutôt qu'en appelant
// les fonctions directement : c'est le seul moyen de vérifier ce qui se passe
// réellement dans la chaîne — middlewares, garde d'authentification, cookies,
// codes de statut.

export function creerClient(base) {
  let cookie = null;

  return {
    /** La session en cours, ou null. Utile pour vérifier qu'elle a été posée. */
    get cookie() {
      return cookie;
    },

    /** Repart d'une session vide, sans toucher au serveur. */
    oublierSession() {
      cookie = null;
    },

    /**
     * Appelle l'API. Renvoie le code, le corps analysé quand il y en a un, et
     * les en-têtes bruts — la pose du cookie ne se vérifie que là.
     */
    async appel(chemin, methode = "GET", corps) {
      const reponse = await fetch(base + chemin, {
        method: methode,
        headers: {
          ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: corps !== undefined ? JSON.stringify(corps) : undefined,
      });

      const posees = reponse.headers.getSetCookie?.() ?? [];
      for (const brute of posees) {
        const [paire] = brute.split(";");
        if (!paire.startsWith("session=")) continue;
        // Une valeur vide est une demande d'effacement, pas une nouvelle session.
        cookie = paire.endsWith("=") ? null : paire;
      }

      return {
        code: reponse.status,
        corps: await reponse.json().catch(() => null),
        cookiesPoses: posees,
      };
    },
  };
}
