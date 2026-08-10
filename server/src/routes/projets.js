import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, ou404 } from "../middleware.js";
import { ProjetSchema, ProjetPartielSchema, VersementSchema } from "../schemas.js";
import { enCentimes, projetVersApi, projetVersDb, versementVersApi } from "../conversion.js";

const routeur = Router();

// Toujours servir les versements avec le projet : l'épargne en est la somme.
const avecVersements = { versements: { orderBy: { date: "desc" } } };

routeur.get("/", attraper(async (_req, res) => {
  const projets = await prisma.projet.findMany({ include: avecVersements, orderBy: { id: "asc" } });
  res.json(projets.map(projetVersApi));
}));

routeur.post("/", valider(ProjetSchema), attraper(async (req, res) => {
  const projet = await prisma.projet.create({ data: projetVersDb(req.donnees), include: avecVersements });
  res.status(201).json(projetVersApi(projet));
}));

routeur.put("/:id", valider(ProjetPartielSchema), attraper(async (req, res) => {
  const projet = await ou404(res, "Projet", () =>
    prisma.projet.update({ where: { id: req.params.id }, data: projetVersDb(req.donnees), include: avecVersements })
  );
  if (projet) res.json(projetVersApi(projet));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  // Les versements suivent (CASCADE en base).
  const projet = await ou404(res, "Projet", () =>
    prisma.projet.delete({ where: { id: req.params.id } })
  );
  if (projet) res.status(204).end();
}));

// Enregistre un mouvement d'enveloppe ; le total épargné du projet
// est recalculé à la lecture comme somme des versements.
routeur.post("/:id/versements", valider(VersementSchema), attraper(async (req, res) => {
  const projet = await prisma.projet.findUnique({ where: { id: req.params.id } });
  if (!projet) return res.status(404).json({ erreur: "Projet introuvable" });

  // `pour` doit désigner un membre existant (ou "foyer").
  const { pour } = req.donnees;
  if (pour !== "foyer" && !(await prisma.membre.findUnique({ where: { id: pour } }))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }

  const versement = await prisma.versement.create({
    data: {
      projetId: projet.id,
      montant: enCentimes(req.donnees.montant),
      membreId: pour === "foyer" ? null : pour,
    },
  });
  res.status(201).json(versementVersApi(versement));
}));

export default routeur;
