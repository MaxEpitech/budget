// Construction de l'application Express, sans la mettre à l'écoute.
//
// Séparer les deux permet de la servir de deux façons : un processus qui écoute
// un port en développement (index.js), et une fonction sans état sur Vercel
// (api/index.js à la racine du dépôt).
import "./env.js";
import express from "express";
import cookieParser from "cookie-parser";
import { chargerSession, exigerAuth } from "./auth/garde.js";
import { cadenceMetier } from "./auth/cadence.js";
import { prisma } from "./db.js";
import { journal, journaliserRequetes } from "./journal.js";
import auth from "./routes/auth.js";
import etat from "./routes/etat.js";
import historique from "./routes/historique.js";
import membres from "./routes/membres.js";
import transactions from "./routes/transactions.js";
import credits from "./routes/credits.js";
import projets from "./routes/projets.js";
import placements from "./routes/placements.js";
import budgets from "./routes/budgets.js";
import foyer from "./routes/foyer.js";
import banque from "./routes/banque.js";

const app = express();

// Un seul intermédiaire de confiance : celui de l'hébergeur. Sans ce réglage,
// l'adresse vue par la limitation de cadence serait celle du proxy — tout le
// monde partagerait le même compteur. `true` serait pire encore : n'importe qui
// pourrait alors se déclarer une autre adresse via un en-tête X-Forwarded-For.
app.set("trust proxy", 1);

app.use(journaliserRequetes);
// Un relevé bancaire pèse plus que les 100 ko admis par défaut : ces deux
// routes, et elles seules, acceptent davantage. Le lecteur général qui suit ne
// retraite pas un corps déjà lu.
app.use(["/api/banque/releve", "/api/transactions/import"], express.json({ limit: "4mb" }));
app.use(express.json());
app.use(cookieParser());
// Renseigne l'utilisateur connecté quand un cookie de session valide est
// présent, sans bloquer : les routes publiques le traversent sans effet.
app.use(chargerSession);

/**
 * Sonde de santé.
 *
 * Elle interroge la base : une sonde qui ne peut pas échouer ne surveille rien.
 * L'application sans sa base ne rend aucun service, autant le dire franchement
 * plutôt que de répondre « tout va bien » devant un écran vide.
 */
app.get("/api/ping", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch (e) {
    journal.erreur("base injoignable", { detail: e.message });
    res.status(503).json({ ok: false, erreur: "Base de données injoignable" });
  }
});

// Seul ensemble de routes accessible sans compte.
app.use("/api/auth", auth);

// Routes métier : session valide, adresse confirmée si elle est exigée, et
// cadence bornée. Chacune lit ensuite son foyer via foyerCourant(req), qui
// refuse de répondre sans session.
//
// Le montage passe par une boucle plutôt que par autant de lignes répétées : oublier
// exigerAuth sur une nouvelle route ouvrirait un foyer à tout le monde, et c'est
// exactement le genre d'omission qu'une liste rend impossible.
const ROUTES_METIER = [
  ["/api/etat", etat],
  ["/api/historique", historique],
  ["/api/membres", membres],
  ["/api/transactions", transactions],
  ["/api/credits", credits],
  ["/api/projets", projets],
  ["/api/placements", placements],
  ["/api/budgets", budgets],
  ["/api/foyer", foyer],
  ["/api/banque", banque],
  // Ancien chemin, du temps où GoCardless était le seul prestataire.
  ["/api/gocardless", banque],
];

for (const [chemin, routeur] of ROUTES_METIER) {
  app.use(chemin, exigerAuth, cadenceMetier, routeur);
}

// Route API inconnue → JSON, pas la page d'erreur HTML d'Express.
app.use("/api", (_req, res) => res.status(404).json({ erreur: "Route inconnue" }));

// JSON malformé → 400 ; tout le reste → 500 avec trace côté serveur.
// L'identifiant de requête figure dans la réponse : c'est lui qui permet de
// retrouver la trace correspondante quand quelqu'un signale un incident.
app.use((err, req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ erreur: "Corps JSON invalide" });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ erreur: "Fichier trop volumineux : exportez une période plus courte." });
  }
  journal.erreur("erreur non rattrapée", {
    identifiant: req.identifiant,
    methode: req.method,
    chemin: req.path,
    detail: err?.message,
    pile: err?.stack,
  });
  res.status(500).json({ erreur: "Erreur serveur inattendue", identifiant: req.identifiant });
});

export default app;
