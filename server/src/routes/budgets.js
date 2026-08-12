import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { BudgetSchema } from "../schemas.js";
import { budgetVersApi, enCentimes } from "../conversion.js";

const routeur = Router();

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const budgets = await prisma.budget.findMany({ where: { foyerId }, orderBy: { categorie: "asc" } });
  res.json(budgets.map(budgetVersApi));
}));

/**
 * Poser ou modifier l'enveloppe d'une catégorie.
 *
 * Un seul point d'entrée plutôt qu'une création et une modification séparées :
 * du point de vue de l'utilisateur, il n'y a qu'un geste — « pour les courses,
 * c'est 500 € » — et savoir si l'enveloppe existait déjà ne le regarde pas.
 * L'unicité en base rend l'opération sûre même si deux personnes du foyer la
 * font en même temps.
 */
routeur.put("/", valider(BudgetSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { categorie, montant } = req.donnees;

  const budget = await prisma.budget.upsert({
    where: { foyerId_categorie: { foyerId, categorie } },
    update: { montant: enCentimes(montant) },
    create: { foyerId, categorie, montant: enCentimes(montant) },
  });
  res.json(budgetVersApi(budget));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await supprimerDansFoyer(res, "Budget", prisma.budget, req.params.id, foyerId)) res.status(204).end();
}));

export default routeur;
