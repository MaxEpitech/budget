// Point d'entrée de l'API Express.
import "./env.js";
import express from "express";
import cookieParser from "cookie-parser";
import { chargerSession, exigerAuth } from "./auth/garde.js";
import { annoncerModeEnvoi } from "./email/envoyer.js";
import auth from "./routes/auth.js";
import etat from "./routes/etat.js";
import membres from "./routes/membres.js";
import transactions from "./routes/transactions.js";
import credits from "./routes/credits.js";
import projets from "./routes/projets.js";
import placements from "./routes/placements.js";
import foyer from "./routes/foyer.js";

const app = express();
app.use(express.json());
app.use(cookieParser());
// Renseigne l'utilisateur connecté quand un cookie de session valide est
// présent, sans bloquer : les routes publiques le traversent sans effet.
app.use(chargerSession);

app.get("/api/ping", (_req, res) => res.json({ ok: true }));

// Seul ensemble de routes accessible sans compte.
app.use("/api/auth", auth);

// Routes métier : session valide et adresse confirmée exigées. Chacune lit
// ensuite son foyer via foyerCourant(req), qui refuse de répondre sans session.
app.use("/api/etat", exigerAuth, etat);
app.use("/api/membres", exigerAuth, membres);
app.use("/api/transactions", exigerAuth, transactions);
app.use("/api/credits", exigerAuth, credits);
app.use("/api/projets", exigerAuth, projets);
app.use("/api/placements", exigerAuth, placements);
app.use("/api/foyer", exigerAuth, foyer);

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

const PORT = Number(process.env.PORT) || 3011;
app.listen(PORT, () => {
  console.log(`API budget démarrée sur http://localhost:${PORT}`);
  annoncerModeEnvoi();
});
