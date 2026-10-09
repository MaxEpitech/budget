import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer, pourValide } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { CreditSchema, PaiementCreditSchema } from "../schemas.js";
import { creditVersApi, creditVersDb, paiementVersApi, enCentimes, dateSaisie } from "../conversion.js";

const routeur = Router();

// Les paiements accompagnent toujours le crédit, du plus récent au plus ancien.
const avecPaiements = { paiements: { orderBy: { date: "desc" } } };

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const credits = await prisma.credit.findMany({ where: { foyerId }, include: avecPaiements, orderBy: { id: "asc" } });
  res.json(credits.map(creditVersApi));
}));

const refuserMembreInconnu = async (req, res, foyerId) => {
  if (await pourValide(req.donnees.pour, foyerId)) return false;
  res.status(400).json({ erreur: "pour : membre inconnu" });
  return true;
};

routeur.post("/", valider(CreditSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await refuserMembreInconnu(req, res, foyerId)) return;
  const credit = await prisma.credit.create({ data: { ...creditVersDb(req.donnees), foyerId } });
  res.status(201).json(creditVersApi(credit));
}));

routeur.put("/:id", valider(CreditSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (await refuserMembreInconnu(req, res, foyerId)) return;
  const credit = await modifierDansFoyer(res, "Crédit", prisma.credit, req.params.id, foyerId, creditVersDb(req.donnees));
  if (credit) res.json(creditVersApi(credit));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // Les paiements suivent (CASCADE en base).
  if (await supprimerDansFoyer(res, "Crédit", prisma.credit, req.params.id, foyerId)) res.status(204).end();
}));

/**
 * Constater qu'une échéance a été prélevée.
 *
 * Rien n'est recalculé : la mensualité et le capital restant dû découlent du
 * contrat, pas des prélèvements. Le paiement dit seulement que l'échéance est
 * passée — et, venu du flux, qu'elle n'y est pas une dépense de plus.
 */
routeur.post("/:id/paiements", valider(PaiementCreditSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const credit = await prisma.credit.findFirst({ where: { id: req.params.id, foyerId }, select: { id: true } });
  if (!credit) return res.status(404).json({ erreur: "Crédit introuvable" });
  if (await refuserMembreInconnu(req, res, foyerId)) return;

  const { pour, date, libelle } = req.donnees;
  const paiement = await prisma.paiementCredit.create({
    data: {
      creditId: credit.id,
      montant: enCentimes(req.donnees.montant),
      membreId: pour === "foyer" ? null : pour,
      date: dateSaisie(date),
      libelle: libelle || null,
    },
  });
  res.status(201).json(paiementVersApi(paiement));
}));

// Le filtre porte sur le crédit ET le foyer : un identifiant venu d'ailleurs se
// comporte exactement comme un identifiant inexistant.
routeur.delete("/:id/paiements/:paiementId", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { count } = await prisma.paiementCredit.deleteMany({
    where: { id: req.params.paiementId, creditId: req.params.id, credit: { foyerId } },
  });
  if (count === 0) return res.status(404).json({ erreur: "Paiement introuvable" });
  res.status(204).end();
}));

export default routeur;
