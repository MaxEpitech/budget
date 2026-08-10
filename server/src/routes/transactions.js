import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, ou404 } from "../middleware.js";
import { TransactionSchema } from "../schemas.js";
import { transactionVersApi, transactionVersDb } from "../conversion.js";

const routeur = Router();

// `pour` doit désigner un membre existant (ou "foyer").
async function pourValide(pour) {
  if (pour === "foyer") return true;
  return Boolean(await prisma.membre.findUnique({ where: { id: pour } }));
}

routeur.get("/", attraper(async (_req, res) => {
  // De la plus récente à la plus ancienne, comme le prototype qui ajoute en tête.
  const transactions = await prisma.transaction.findMany({ orderBy: { id: "desc" } });
  res.json(transactions.map(transactionVersApi));
}));

routeur.post("/", valider(TransactionSchema), attraper(async (req, res) => {
  if (!(await pourValide(req.donnees.pour))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }
  const transaction = await prisma.transaction.create({ data: transactionVersDb(req.donnees) });
  res.status(201).json(transactionVersApi(transaction));
}));

routeur.put("/:id", valider(TransactionSchema), attraper(async (req, res) => {
  if (!(await pourValide(req.donnees.pour))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }
  const transaction = await ou404(res, "Transaction", () =>
    prisma.transaction.update({ where: { id: req.params.id }, data: transactionVersDb(req.donnees) })
  );
  if (transaction) res.json(transactionVersApi(transaction));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const transaction = await ou404(res, "Transaction", () =>
    prisma.transaction.delete({ where: { id: req.params.id } })
  );
  if (transaction) res.status(204).end();
}));

export default routeur;
