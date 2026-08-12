import { Router } from "express";
import { prisma } from "../db.js";
import { attraper } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { MoisSchema } from "../schemas.js";
import { totauxDuMois } from "../finance.js";
import { moisCourant, decalerMois } from "../mois.js";
import { membreVersApi, transactionVersApi, creditVersApi, projetVersApi, placementVersApi } from "../conversion.js";

const routeur = Router();

// Douze mois par défaut : une année entière, de quoi voir revenir les échéances
// annuelles. Borné pour qu'une requête ne demande pas cent ans de calcul.
const MOIS_PAR_DEFAUT = 12;
const MOIS_MAXIMUM = 60;

/**
 * L'évolution du budget mois par mois.
 *
 * Tout est lu une fois puis recalculé en mémoire pour chaque mois : les données
 * ne dépendent pas du mois, seule leur interprétation change. Douze requêtes à
 * la base pour douze mois seraient douze fois le même travail.
 */
routeur.get("/", attraper(async (req, res) => {
  const jusqu = req.query.jusqu ?? moisCourant();
  if (!MoisSchema.safeParse(jusqu).success) {
    return res.status(400).json({ erreur: "jusqu : format YYYY-MM attendu" });
  }

  const demande = Number(req.query.mois ?? MOIS_PAR_DEFAUT);
  if (!Number.isInteger(demande) || demande < 1 || demande > MOIS_MAXIMUM) {
    return res.status(400).json({ erreur: `mois : nombre entier entre 1 et ${MOIS_MAXIMUM}` });
  }

  const foyerId = await foyerCourant(req);
  const [membres, transactions, credits, projets, placements] = await Promise.all([
    prisma.membre.findMany({ where: { foyerId } }),
    prisma.transaction.findMany({ where: { foyerId } }),
    prisma.credit.findMany({ where: { foyerId } }),
    prisma.projet.findMany({ where: { foyerId }, include: { versements: true } }),
    prisma.placement.findMany({ where: { foyerId } }),
  ]);

  // Converties en euros une fois pour toutes : les totaux se calculent ensuite
  // exactement comme côté client, avec la même fonction.
  const donnees = {
    membres: membres.map(membreVersApi),
    transactions: transactions.map(transactionVersApi),
    credits: credits.map(creditVersApi),
    projets: projets.map(projetVersApi),
    placements: placements.map(placementVersApi),
  };

  const serie = [];
  for (let i = demande - 1; i >= 0; i--) {
    serie.push(totauxDuMois(donnees, decalerMois(jusqu, -i)));
  }

  res.json({ jusqu, serie });
}));

export default routeur;
