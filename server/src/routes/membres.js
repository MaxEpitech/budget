import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, ou404 } from "../middleware.js";
import { MembreSchema, MembrePartielSchema } from "../schemas.js";
import { membreVersApi, membreVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (_req, res) => {
  const membres = await prisma.membre.findMany({ orderBy: { id: "asc" } });
  res.json(membres.map(membreVersApi));
}));

routeur.post("/", valider(MembreSchema), attraper(async (req, res) => {
  const membre = await prisma.membre.create({ data: membreVersDb(req.donnees) });
  res.status(201).json(membreVersApi(membre));
}));

routeur.put("/:id", valider(MembrePartielSchema), attraper(async (req, res) => {
  const membre = await ou404(res, "Membre", () =>
    prisma.membre.update({ where: { id: req.params.id }, data: membreVersDb(req.donnees) })
  );
  if (membre) res.json(membreVersApi(membre));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  // Les transactions du membre redeviennent des lignes du foyer (SET NULL en base).
  const membre = await ou404(res, "Membre", () =>
    prisma.membre.delete({ where: { id: req.params.id } })
  );
  if (membre) res.status(204).end();
}));

export default routeur;
