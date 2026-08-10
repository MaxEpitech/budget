// Point d'entrée de l'API Express.
import "./env.js";
import express from "express";
import etat from "./routes/etat.js";
import membres from "./routes/membres.js";
import transactions from "./routes/transactions.js";
import credits from "./routes/credits.js";
import projets from "./routes/projets.js";
import placements from "./routes/placements.js";
import foyer from "./routes/foyer.js";

const app = express();
app.use(express.json());

app.get("/api/ping", (_req, res) => res.json({ ok: true }));
app.use("/api/etat", etat);
app.use("/api/membres", membres);
app.use("/api/transactions", transactions);
app.use("/api/credits", credits);
app.use("/api/projets", projets);
app.use("/api/placements", placements);
app.use("/api/foyer", foyer);

// Route API inconnue → JSON, pas la page d'erreur HTML d'Express.
app.use("/api", (_req, res) => res.status(404).json({ erreur: "Route inconnue" }));

// JSON malformé → 400 ; tout le reste → 500 avec trace côté serveur.
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ erreur: "Corps JSON invalide" });
  }
  console.error(err);
  res.status(500).json({ erreur: "Erreur serveur inattendue" });
});

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`API budget démarrée sur http://localhost:${PORT}`);
});
