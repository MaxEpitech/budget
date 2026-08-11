// Point d'entrée de l'API sur Vercel.
//
// Une application Express est une fonction (req, res) : elle se comporte
// directement comme un gestionnaire de fonction sans état. Aucun port, aucun
// processus permanent — c'est la même application qu'en développement.
import app from "../server/src/app.js";

export default function handler(req, res) {
  // Les routes sont montées sur /api/… dans l'application. Selon la manière
  // dont la réécriture achemine la requête, l'URL reçue peut avoir perdu ce
  // préfixe ; on le rétablit pour que le routage soit identique aux deux bouts.
  if (!req.url.startsWith("/api")) {
    req.url = `/api${req.url.startsWith("/") ? "" : "/"}${req.url}`;
  }
  return app(req, res);
}
