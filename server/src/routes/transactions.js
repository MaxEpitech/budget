import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer, pourValide } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { randomUUID } from "node:crypto";
import { TransactionSchema, ImportTransactionsSchema } from "../schemas.js";
import { transactionVersApi, transactionVersDb, enCentimes, dateSaisie } from "../conversion.js";
import { empreintesConnues } from "../banque/empreintes.js";

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

const jourLisible = (iso) => iso.split("-").reverse().join("/");
const parDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * Fait entrer les opérations d'un relevé, validées dans l'aperçu.
 *
 * Une opération ordinaire devient une ligne ponctuelle du flux, à sa date. Une
 * opération affectée est un mouvement interne : elle alimente un support
 * d'épargne, un projet ou un crédit, et n'est pas une dépense — le budget compte
 * déjà le versement prévu ou l'échéance. Tout s'écrit d'un bloc : un import
 * n'est jamais à moitié fait.
 *
 * Celles déjà importées — même clé, sous quelque forme que ce soit — sont
 * passées sans erreur : réimporter un relevé, ou en importer un qui le
 * chevauche, est un geste normal. Le lot renvoyé permet d'annuler l'import.
 */
routeur.post("/import", valider(ImportTransactionsSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { pour, operations } = req.donnees;
  if (!(await pourValide(pour, foyerId))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }

  const connues = await empreintesConnues(foyerId, operations.map((o) => o.cle));
  const nouvelles = operations.filter((o) => !connues.has(o.cle));
  const ordinaires = nouvelles.filter((o) => !o.affectation);
  const internes = nouvelles.filter((o) => o.affectation);
  const vers = (nature) => internes.filter((o) => o.affectation.nature === nature);
  const destinations = (nature) => [...new Set(vers(nature).map((o) => o.affectation.id))];

  // Une destination doit appartenir au foyer : celle d'un autre foyer se
  // comporte comme une destination inexistante.
  const [placements, projets, credits] = await Promise.all([
    prisma.placement.findMany({ where: { foyerId, id: { in: destinations("epargne") } } }),
    prisma.projet.findMany({ where: { foyerId, id: { in: destinations("projet") } }, select: { id: true } }),
    prisma.credit.findMany({ where: { foyerId, id: { in: destinations("credit") } }, select: { id: true } }),
  ]);
  if (
    placements.length !== destinations("epargne").length ||
    projets.length !== destinations("projet").length ||
    credits.length !== destinations("credit").length
  ) {
    return res.status(400).json({ erreur: "Destination inconnue : un support, un projet ou un crédit a peut-être été supprimé entre-temps." });
  }
  // Un projet se remplit, un crédit se rembourse : seule l'épargne peut être
  // à l'origine d'une entrée d'argent sur le compte.
  const entree = internes.find((o) => o.type === "revenu" && o.affectation.nature !== "epargne");
  if (entree) {
    return res.status(400).json({ erreur: `« ${entree.libelle} » est une entrée d'argent : elle ne peut alimenter un projet ou un crédit.` });
  }

  const lot = randomUUID();
  const membreId = pour === "foyer" ? null : pour;
  const reperes = (o) => ({ montant: enCentimes(o.montant), date: dateSaisie(o.date), libelle: o.libelle, membreId, importCle: o.cle, importLot: lot });
  const ecritures = [];

  if (ordinaires.length > 0) {
    ecritures.push(prisma.transaction.createMany({
      data: ordinaires.map((o) => ({
        ...transactionVersDb({ ...o, pour, recurrent: false, mois: o.date.slice(0, 7) }),
        importCle: o.cle,
        importLot: lot,
        foyerId,
      })),
      // L'unicité (foyer, clé) départage deux imports simultanés du même relevé.
      skipDuplicates: true,
    }));
  }

  // Épargne : la valeur du support suit chaque mouvement, dans l'ordre des
  // dates, avec les mêmes refus qu'un mouvement saisi à la main. Refuser vaut
  // mieux que rogner : un historique tronqué ne correspondrait à aucune
  // opération réelle.
  for (const placement of placements) {
    const siens = vers("epargne").filter((o) => o.affectation.id === placement.id).sort(parDate);
    let valeur = placement.valeur;
    for (const o of siens) {
      const type = o.type === "depense" ? "versement" : "retrait";
      valeur += (type === "versement" ? 1 : -1) * enCentimes(o.montant);
      if (valeur < 0) {
        return res.status(400).json({
          erreur: `Le retrait « ${o.libelle} » du ${jourLisible(o.date)} dépasse la valeur enregistrée de ${placement.libelle} : mettez-la à jour dans Épargne, puis importez de nouveau.`,
        });
      }
      if (type === "versement" && placement.plafond != null && valeur > placement.plafond) {
        return res.status(400).json({
          erreur: `Le versement « ${o.libelle} » du ${jourLisible(o.date)} ferait dépasser le plafond de ${placement.libelle} : vérifiez sa valeur dans Épargne, puis importez de nouveau.`,
        });
      }
      ecritures.push(prisma.mouvementPlacement.create({ data: { ...reperes(o), placementId: placement.id, type, valeurApres: valeur } }));
    }
    ecritures.push(prisma.placement.update({ where: { id: placement.id }, data: { valeur } }));
  }
  if (vers("projet").length > 0) {
    ecritures.push(prisma.versement.createMany({ data: vers("projet").map((o) => ({ ...reperes(o), projetId: o.affectation.id })) }));
  }
  if (vers("credit").length > 0) {
    ecritures.push(prisma.paiementCredit.createMany({ data: vers("credit").map((o) => ({ ...reperes(o), creditId: o.affectation.id })) }));
  }

  const resultats = await prisma.$transaction(ecritures);
  const ajouteesAuFlux = ordinaires.length > 0 ? resultats[0].count : 0;
  const ajoutees = ajouteesAuFlux + internes.length;
  res.status(201).json({ lot, ajoutees, internes: internes.length, dejaPresentes: operations.length - ajoutees });
}));

/**
 * Annule un import : retire tout ce que ce lot a créé, et cela seul — lignes du
 * flux comme mouvements internes. La valeur des supports d'épargne revient sur
 * ce que les mouvements y avaient ajouté ou retiré.
 */
routeur.delete("/import/:lot", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const importLot = req.params.lot;

  const mouvements = await prisma.mouvementPlacement.findMany({ where: { importLot, placement: { foyerId } } });
  const effets = new Map();
  for (const m of mouvements) effets.set(m.placementId, (effets.get(m.placementId) ?? 0) + (m.type === "retrait" ? m.montant : -m.montant));
  const supports = await prisma.placement.findMany({ where: { id: { in: [...effets.keys()] } }, select: { id: true, valeur: true } });

  const resultats = await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { foyerId, importLot } }),
    prisma.mouvementPlacement.deleteMany({ where: { importLot, placement: { foyerId } } }),
    prisma.versement.deleteMany({ where: { importLot, projet: { foyerId } } }),
    prisma.paiementCredit.deleteMany({ where: { importLot, credit: { foyerId } } }),
    ...supports.map((s) => prisma.placement.update({ where: { id: s.id }, data: { valeur: Math.max(0, s.valeur + effets.get(s.id)) } })),
  ]);
  const count = resultats.slice(0, 4).reduce((total, r) => total + r.count, 0);
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
