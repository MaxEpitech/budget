import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { MembreSchema, MembrePartielSchema } from "../schemas.js";
import { membreVersApi, membreVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const membres = await prisma.membre.findMany({ where: { foyerId }, orderBy: { id: "asc" } });
  res.json(membres.map(membreVersApi));
}));

routeur.post("/", valider(MembreSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const membre = await prisma.membre.create({ data: { ...membreVersDb(req.donnees), foyerId } });
  res.status(201).json(membreVersApi(membre));
}));

routeur.put("/:id", valider(MembrePartielSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const membre = await modifierDansFoyer(res, "Membre", prisma.membre, req.params.id, foyerId, membreVersDb(req.donnees));
  if (membre) res.json(membreVersApi(membre));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // Les transactions du membre redeviennent des lignes du foyer (SET NULL en base).
  if (await supprimerDansFoyer(res, "Membre", prisma.membre, req.params.id, foyerId)) res.status(204).end();
}));

export default routeur;
