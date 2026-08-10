import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, ou404 } from "../middleware.js";
import { PlacementSchema, PlacementPartielSchema } from "../schemas.js";
import { placementVersApi, placementVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (_req, res) => {
  const placements = await prisma.placement.findMany({ orderBy: { id: "asc" } });
  res.json(placements.map(placementVersApi));
}));

routeur.post("/", valider(PlacementSchema), attraper(async (req, res) => {
  const placement = await prisma.placement.create({ data: placementVersDb(req.donnees) });
  res.status(201).json(placementVersApi(placement));
}));

routeur.put("/:id", valider(PlacementPartielSchema), attraper(async (req, res) => {
  const placement = await ou404(res, "Placement", () =>
    prisma.placement.update({ where: { id: req.params.id }, data: placementVersDb(req.donnees) })
  );
  if (placement) res.json(placementVersApi(placement));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const placement = await ou404(res, "Placement", () =>
    prisma.placement.delete({ where: { id: req.params.id } })
  );
  if (placement) res.status(204).end();
}));

export default routeur;
