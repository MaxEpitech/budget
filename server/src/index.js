// Point d'entrée de l'API Express.
// Étape 1 : coquille minimale — les routes métier arrivent à l'étape 3.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import express from "express";

// Le .env vit à la racine du repo, quel que soit le répertoire de lancement.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const app = express();
app.use(express.json());

app.get("/api/ping", (_req, res) => {
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`API budget démarrée sur http://localhost:${PORT}`);
});
