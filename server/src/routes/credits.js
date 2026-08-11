import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { CreditSchema } from "../schemas.js";
import { creditVersApi, creditVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const credits = await prisma.credit.findMany({ where: { foyerId }, orderBy: { id: "asc" } });
  res.json(credits.map(creditVersApi));
}));

routeur.post("/", valider(CreditSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const credit = await prisma.credit.create({ data: { ...creditVersDb(req.donnees), foyerId } });
  res.status(201).json(creditVersApi(credit));
}));

routeur.put("/:id", valider(CreditSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const credit = await modifierDansFoyer(res, "Crédit", prisma.credit, req.params.id, foyerId, creditVersDb(req.donnees));
  if (credit) res.json(creditVersApi(credit));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await supprimerDansFoyer(res, "Crédit", prisma.credit, req.params.id, foyerId)) res.status(204).end();
}));

export default routeur;
