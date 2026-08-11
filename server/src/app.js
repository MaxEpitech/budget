// Construction de l'application Express, sans la mettre à l'écoute.
//
// Séparer les deux permet de la servir de deux façons : un processus qui écoute
// un port en développement (index.js), et une fonction sans état sur Vercel
// (api/index.js à la racine du dépôt).
import "./env.js";
import express from "express";
import cookieParser from "cookie-parser";
import { chargerSession, exigerAuth } from "./auth/garde.js";
import auth from "./routes/auth.js";
import etat from "./routes/etat.js";
import membres from "./routes/membres.js";
import transactions from "./routes/transactions.js";
import credits from "./routes/credits.js";
import projets from "./routes/projets.js";
import placements from "./routes/placements.js";
import foyer from "./routes/foyer.js";

const app = express();

// Un seul intermédiaire de confiance : celui de l'hébergeur. Sans ce réglage,
// l'adresse vue par la limitation de cadence serait celle du proxy — tout le
// monde partagerait le même compteur. `true` serait pire encore : n'importe qui
// pourrait alors se déclarer une autre adresse via un en-tête X-Forwarded-For.
app.set("trust proxy", 1);

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

export default app;
