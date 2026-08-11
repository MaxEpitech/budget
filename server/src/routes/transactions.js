import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { TransactionSchema } from "../schemas.js";
import { transactionVersApi, transactionVersDb } from "../conversion.js";

const routeur = Router();

// `pour` doit désigner "foyer" ou un membre du foyer courant.
async function pourValide(pour, foyerId) {
  if (pour === "foyer") return true;
  return Boolean(await prisma.membre.findFirst({ where: { id: pour, foyerId } }));
}

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // De la plus récente à la plus ancienne, comme le prototype qui ajoute en tête.
  const transactions = await prisma.transaction.findMany({ where: { foyerId }, orderBy: { id: "desc" } });
  res.json(transactions.map(transactionVersApi));
}));

routeur.post("/", valider(TransactionSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (!(await pourValide(req.donnees.pour, foyerId))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }
  const transaction = await prisma.transaction.create({ data: { ...transactionVersDb(req.donnees), foyerId } });
  res.status(201).json(transactionVersApi(transaction));
}));

routeur.put("/:id", valider(TransactionSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (!(await pourValide(req.donnees.pour, foyerId))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }
  const transaction = await modifierDansFoyer(res, "Transaction", prisma.transaction, req.params.id, foyerId, transactionVersDb(req.donnees));
  if (transaction) res.json(transactionVersApi(transaction));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await supprimerDansFoyer(res, "Transaction", prisma.transaction, req.params.id, foyerId)) res.status(204).end();
}));

export default routeur;
