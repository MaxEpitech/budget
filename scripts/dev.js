// Lanceur de développement : réserve des ports libres avant de démarrer le
// client et l'API. Un port déjà pris (autre projet, instance restée ouverte)
// décale le démarrage au port suivant au lieu de faire échouer `npm run dev`.
import { createConnection, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import concurrently from "concurrently";

// Même .env que le serveur : PORT n'est écrit qu'à un seul endroit.
config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const PORT_API_DEFAUT = 3011;
const PORT_CLIENT_DEFAUT = 5173;
const PORTS_A_ESSAYER = 20;

// Peut-on écouter ce port sur toutes les interfaces, comme le fait Express ?
const peutEcouter = (port) =>
  new Promise((resolve) => {
    const sonde = createServer();
    sonde.once("error", () => resolve(false));
    sonde.once("listening", () => sonde.close(() => resolve(true)));
    sonde.listen(port);
  });

// Windows laisse écouter 0.0.0.0 alors qu'un autre programme tient déjà
// 127.0.0.1 ou ::1 — c'est le cas de Vite, qui n'écoute que la boucle locale.
// Seule une connexion qui aboutit prouve que le port est pris.
const personneNEcoute = (port, hote) =>
  new Promise((resolve) => {
    const prise = createConnection({ port, host: hote });
    const conclure = (libre) => {
      prise.destroy();
      resolve(libre);
    };
    prise.setTimeout(500);
    prise.once("connect", () => conclure(false));
    // Connexion refusée, hôte IPv6 absent ou sans réponse : personne n'écoute.
    prise.once("error", () => conclure(true));
    prise.once("timeout", () => conclure(true));
  });

async function portLibre(port) {
  if (!(await peutEcouter(port))) return false;
  for (const hote of ["127.0.0.1", "::1"]) {
    if (!(await personneNEcoute(port, hote))) return false;
  }
  return true;
}

async function choisirPort(quoi, souhaite) {
  for (let port = souhaite; port < souhaite + PORTS_A_ESSAYER; port++) {
    if (await portLibre(port)) {
      if (port !== souhaite) {
        console.log(`Port ${souhaite} déjà utilisé : ${quoi} démarre sur ${port}.`);
      }
      return port;
    }
  }
  throw new Error(
    `Aucun port libre pour ${quoi} entre ${souhaite} et ${souhaite + PORTS_A_ESSAYER - 1}.`,
  );
}

const portApi = await choisirPort("l'API", Number(process.env.PORT) || PORT_API_DEFAUT);
const portClient = await choisirPort(
  "le client",
  Number(process.env.PORT_CLIENT) || PORT_CLIENT_DEFAUT,
);

// Transmis aux deux processus : le serveur écoute PORT, et vite.config.js s'en
// sert pour son propre port comme pour la cible du proxy /api.
process.env.PORT = String(portApi);
process.env.PORT_CLIENT = String(portClient);
// Les liens envoyés par email pointent vers le client : ils suivent son port,
// sauf si une adresse publique est déjà fixée dans le .env.
if (!process.env.APP_URL) {
  process.env.APP_URL = `http://localhost:${portClient}`;
}

const { result } = concurrently([
  { command: "npm:dev:client", name: "client", prefixColor: "cyan" },
  { command: "npm:dev:server", name: "server", prefixColor: "green" },
]);

// Sans ce catch, l'arrêt d'une des deux commandes remonte en rejet non géré.
result.catch((evenements) => {
  const echec = [].concat(evenements).find((evenement) => evenement?.exitCode);
  process.exit(Number(echec?.exitCode) || 1);
});
