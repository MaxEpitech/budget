// Serveur de développement : met l'application Express à l'écoute d'un port.
// En production sur Vercel, c'est api/index.js qui sert la même application,
// sans processus permanent ni port.
import app from "./app.js";
import { annoncerModeEnvoi } from "./email/envoyer.js";

const PORT = Number(process.env.PORT) || 3011;
const PORTS_A_ESSAYER = 20;
// Un redémarrage de `node --watch` rend le port avec un peu de retard : on
// réessaie le même avant d'en changer, sinon l'API s'éloignerait du proxy du
// client à chaque sauvegarde de fichier.
const REPRISES_MEME_PORT = 3;
const DELAI_REPRISE_MS = 300;

function ecouter(port, reprises) {
  const serveur = app.listen(port, () => {
    if (port !== PORT) {
      console.warn(
        `Port ${PORT} déjà utilisé : l'API écoute sur ${port}. ` +
          "Relancer `npm run dev` pour que le proxy du client suive.",
      );
    }
    console.log(`API budget démarrée sur http://localhost:${port}`);
    annoncerModeEnvoi();
  });

  serveur.on("error", (err) => {
    if (err.code !== "EADDRINUSE") {
      console.error(err);
      process.exit(1);
    }
    if (reprises > 0) {
      setTimeout(() => ecouter(port, reprises - 1), DELAI_REPRISE_MS);
      return;
    }
    if (port + 1 >= PORT + PORTS_A_ESSAYER) {
      console.error(
        `Aucun port libre entre ${PORT} et ${PORT + PORTS_A_ESSAYER - 1} pour l'API.`,
      );
      process.exit(1);
    }
    ecouter(port + 1, 0);
  });
}

ecouter(PORT, REPRISES_MEME_PORT);
