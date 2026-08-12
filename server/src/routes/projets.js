import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { ProjetSchema, ProjetPartielSchema, VersementSchema } from "../schemas.js";
import { enCentimes, projetVersApi, projetVersDb, versementVersApi } from "../conversion.js";

const routeur = Router();

// Toujours servir les versements avec le projet : l'épargne en est la somme.
const avecVersements = { versements: { orderBy: { date: "desc" } } };

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const projets = await prisma.projet.findMany({ where: { foyerId }, include: avecVersements, orderBy: { id: "asc" } });
  res.json(projets.map(projetVersApi));
}));

routeur.post("/", valider(ProjetSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const projet = await prisma.projet.create({ data: { ...projetVersDb(req.donnees), foyerId }, include: avecVersements });
  res.status(201).json(projetVersApi(projet));
}));

routeur.put("/:id", valider(ProjetPartielSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const modifie = await modifierDansFoyer(res, "Projet", prisma.projet, req.params.id, foyerId, projetVersDb(req.donnees));
  if (!modifie) return;
  const projet = await prisma.projet.findUnique({ where: { id: modifie.id }, include: avecVersements });
  res.json(projetVersApi(projet));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // Les versements suivent (CASCADE en base).
  if (await supprimerDansFoyer(res, "Projet", prisma.projet, req.params.id, foyerId)) res.status(204).end();
}));

// Enregistre un mouvement d'enveloppe ; le total épargné du projet
// est recalculé à la lecture comme somme des versements.
routeur.post("/:id/versements", valider(VersementSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // Le versement n'est possible que sur un projet du foyer.
  const projet = await prisma.projet.findFirst({ where: { id: req.params.id, foyerId } });
  if (!projet) return res.status(404).json({ erreur: "Projet introuvable" });

  // `pour` doit désigner "foyer" ou un membre du foyer courant.
  const { pour } = req.donnees;
  if (pour !== "foyer" && !(await prisma.membre.findFirst({ where: { id: pour, foyerId } }))) {
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

/**
 * Retirer un versement de l'historique.
 *
 * L'épargne du projet étant la somme de ses versements, elle se corrige d'
 * elle-même : rien à recalculer, rien qui puisse diverger. C'est tout
 * l'intérêt de ne jamais avoir figé ce total.
 *
 * Le filtre porte sur le projet ET le foyer : un identifiant venu d'ailleurs se
 * comporte exactement comme un identifiant inexistant.
 */
routeur.delete("/:id/versements/:versementId", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const supprimes = await prisma.versement.deleteMany({
    where: { id: req.params.versementId, projetId: req.params.id, projet: { foyerId } },
  });
  if (supprimes.count === 0) return res.status(404).json({ erreur: "Versement introuvable" });
  res.status(204).end();
}));

export default routeur;
