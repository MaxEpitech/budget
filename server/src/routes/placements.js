import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { PlacementSchema, PlacementPartielSchema } from "../schemas.js";
import { placementVersApi, placementVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placements = await prisma.placement.findMany({ where: { foyerId }, orderBy: { id: "asc" } });
  res.json(placements.map(placementVersApi));
}));

routeur.post("/", valider(PlacementSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placement = await prisma.placement.create({ data: { ...placementVersDb(req.donnees), foyerId } });
  res.status(201).json(placementVersApi(placement));
}));

routeur.put("/:id", valider(PlacementPartielSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placement = await modifierDansFoyer(res, "Placement", prisma.placement, req.params.id, foyerId, placementVersDb(req.donnees));
  if (placement) res.json(placementVersApi(placement));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await supprimerDansFoyer(res, "Placement", prisma.placement, req.params.id, foyerId)) res.status(204).end();
}));

export default routeur;
