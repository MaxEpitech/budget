import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer, pourValide } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { randomUUID } from "node:crypto";
import { TransactionSchema, ImportTransactionsSchema } from "../schemas.js";
import { transactionVersApi, transactionVersDb } from "../conversion.js";

const routeur = Router();

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

/**
 * Fait entrer dans le flux les opérations d'un relevé, validées dans l'aperçu.
 *
 * Chacune devient une ligne ponctuelle, à sa date. Celles déjà importées — même
 * clé — sont passées sans erreur : réimporter un relevé, ou en importer un qui
 * le chevauche, est un geste normal. Le lot renvoyé permet d'annuler l'import.
 */
routeur.post("/import", valider(ImportTransactionsSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { pour, operations } = req.donnees;
  if (!(await pourValide(pour, foyerId))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }

  const lot = randomUUID();
  const { count } = await prisma.transaction.createMany({
    data: operations.map((o) => ({
      ...transactionVersDb({ ...o, pour, recurrent: false, mois: o.date.slice(0, 7) }),
      importCle: o.cle,
      importLot: lot,
      foyerId,
    })),
    // L'unicité (foyer, clé) fait le tri : pas de lecture préalable à tenir à jour.
    skipDuplicates: true,
  });

  res.status(201).json({ lot, ajoutees: count, dejaPresentes: operations.length - count });
}));

/** Annule un import : retire toutes les lignes de ce lot, et elles seules. */
routeur.delete("/import/:lot", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { count } = await prisma.transaction.deleteMany({ where: { foyerId, importLot: req.params.lot } });
  if (count === 0) return res.status(404).json({ erreur: "Import introuvable" });
  res.json({ retirees: count });
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
