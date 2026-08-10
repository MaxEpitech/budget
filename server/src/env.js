// Charge le .env de la racine du repo, quel que soit le répertoire de lancement.
// À importer en premier par tout point d'entrée (index, seed…).
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
