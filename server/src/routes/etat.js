import { Router } from "express";
import { prisma } from "../db.js";
import { attraper } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { MoisSchema } from "../schemas.js";
import { mensualite, capitalRestant, quotePart, echeanceCeMois } from "../finance.js";
import { moisCourant, ecartMois } from "../mois.js";
import {
  membreVersApi,
  transactionVersApi,
  creditVersApi,
  projetVersApi,
  placementVersApi,
  budgetVersApi,
} from "../conversion.js";

const routeur = Router();

// Tout ce dont le dashboard a besoin pour un mois donné, en une requête.
routeur.get("/", attraper(async (req, res) => {
  const mois = req.query.mois ?? moisCourant();
  if (!MoisSchema.safeParse(mois).success) {
    return res.status(400).json({ erreur: "mois : format YYYY-MM attendu" });
  }

  const foyerId = await foyerCourant(req);
  const [foyer, membresDb, transactionsDb, creditsDb, projetsDb, placementsDb, budgetsDb] = await Promise.all([
    prisma.foyer.findUnique({ where: { id: foyerId } }),
    prisma.membre.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
    // Les récurrentes sont filtrées ensuite : leur période de validité et leur
    // rythme se calculent, ils ne s'expriment pas en clause SQL simple.
    prisma.transaction.findMany({ where: { foyerId, OR: [{ recurrent: true }, { mois }] }, orderBy: { id: "desc" } }),
    prisma.credit.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
    prisma.projet.findMany({ where: { foyerId }, include: { versements: { orderBy: { date: "desc" } } }, orderBy: { id: "asc" } }),
    // Les mouvements viennent avec : c'est eux qui disent si le versement
    // mensuel annoncé a réellement eu lieu ce mois-ci.
    prisma.placement.findMany({ where: { foyerId }, include: { mouvements: { orderBy: { date: "desc" } } }, orderBy: { id: "asc" } }),
    prisma.budget.findMany({ where: { foyerId }, orderBy: { categorie: "asc" } }),
  ]);

  const repartition = foyer?.repartition ?? "prorata";
  const membres = membresDb.map(membreVersApi);
  // Une récurrente ne compte que si le mois est bien une de ses échéances :
  // commencée, pas terminée, et au bon rythme.
  const transactions = transactionsDb
    .filter((t) => !t.recurrent || echeanceCeMois(t, mois))
    .map(transactionVersApi);
  const projets = projetsDb.map(projetVersApi);
  const placements = placementsDb.map(placementVersApi);

  // Chaque enveloppe est servie avec ce qui en a déjà été consommé ce mois-ci :
  // le montant seul ne dit rien, c'est l'écart qui intéresse.
  const depensesParCategorie = transactions
    .filter((t) => t.type === "depense")
    .reduce((somme, t) => ({ ...somme, [t.categorie]: (somme[t.categorie] ?? 0) + t.montant }), {});
  const budgets = budgetsDb.map((b) => {
    const budget = budgetVersApi(b);
    return { ...budget, consomme: depensesParCategorie[budget.categorie] ?? 0 };
  });

  // Crédits enrichis comme dans le calcul du prototype :
  // k échéances passées, mensualité, capital restant dû, crédit soldé.
  const credits = creditsDb.map((c) => {
    const base = creditVersApi(c);
    const k = Math.max(0, ecartMois(base.debut, mois));
    return {
      ...base,
      k,
      mensualite: mensualite(base.capital, base.taux, base.duree),
      restant: capitalRestant(base.capital, base.taux, base.duree, k),
      solde: k >= base.duree,
    };
  });

  // Répartition par membre — mêmes règles que le prototype.
  const salaires = membres.reduce((s, m) => s + m.revenu, 0);
  const mensualitesCredits = credits.filter((c) => !c.solde).reduce((s, c) => s + c.mensualite, 0);
  const versementsProjets = projets.reduce((s, p) => s + p.versement, 0);
  const versementsPlacements = placements.reduce((s, p) => s + p.versement, 0);
  const communes = transactions
    .filter((t) => t.type === "depense" && t.pour === "foyer")
    .reduce((s, t) => s + t.montant, 0);
  const chargesFoyer = communes + mensualitesCredits + versementsProjets + versementsPlacements;

  const parMembre = membres.map((m) => {
    const part = quotePart(m.revenu, salaires, membres.length, repartition);
    const perso = transactions
      .filter((t) => t.type === "depense" && t.pour === m.id)
      .reduce((s, t) => s + t.montant, 0);
    const bonus = transactions
      .filter((t) => t.type === "revenu" && t.pour === m.id)
      .reduce((s, t) => s + t.montant, 0);
    const du = chargesFoyer * part;
    return { ...m, part, perso, bonus, du, reste: m.revenu + bonus - du - perso };
  });

  res.json({ mois, repartition, membres, transactions, credits, projets, placements, budgets, parMembre });
}));

export default routeur;
