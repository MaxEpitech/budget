import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, ou404 } from "../middleware.js";
import { CreditSchema } from "../schemas.js";
import { creditVersApi, creditVersDb } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (_req, res) => {
  const credits = await prisma.credit.findMany({ orderBy: { id: "asc" } });
  res.json(credits.map(creditVersApi));
}));

routeur.post("/", valider(CreditSchema), attraper(async (req, res) => {
  const credit = await prisma.credit.create({ data: creditVersDb(req.donnees) });
  res.status(201).json(creditVersApi(credit));
}));

routeur.put("/:id", valider(CreditSchema), attraper(async (req, res) => {
  const credit = await ou404(res, "Crédit", () =>
    prisma.credit.update({ where: { id: req.params.id }, data: creditVersDb(req.donnees) })
  );
  if (credit) res.json(creditVersApi(credit));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const credit = await ou404(res, "Crédit", () =>
    prisma.credit.delete({ where: { id: req.params.id } })
  );
  if (credit) res.status(204).end();
}));

export default routeur;
