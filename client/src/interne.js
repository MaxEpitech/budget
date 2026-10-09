// Mouvements internes : l'argent qui passe du compte à l'épargne, à un projet
// ou au remboursement d'un crédit.
//
// Ce ne sont pas des dépenses. Le budget compte déjà, chaque mois, le versement
// prévu de chaque support et de chaque projet, et l'échéance de chaque crédit ;
// saisis comme dépenses, ces mouvements pèseraient deux fois. Ils sont donc
// enregistrés là où ils agissent — mouvement d'épargne, versement de projet,
// paiement de crédit — et l'écran Opérations les montre à part, sans les compter.
import { api } from "./api.js";
import { moisCle } from "./utiles.js";

export const NATURES = {
  epargne: { nom: "Épargne", icone: "epargne", ecran: "epargne", teinte: "var(--epargne)" },
  projet: { nom: "Projet", icone: "projets", ecran: "projets", teinte: "var(--projets)" },
  credit: { nom: "Crédit", icone: "credits", ecran: "credits", teinte: "var(--credits)" },
};

/** « epargne:abc » ↔ { nature: "epargne", id: "abc" } : la valeur d'une liste de choix. */
export const versValeur = (affectation) => (affectation ? `${affectation.nature}:${affectation.id}` : "");
export const depuisValeur = (valeur) => {
  const [nature, ...reste] = String(valeur ?? "").split(":");
  return NATURES[nature] && reste.length ? { nature, id: reste.join(":") } : null;
};

/**
 * Les destinations possibles, en groupes pour une liste de choix.
 * @param entree une entrée d'argent ne peut venir que de l'épargne
 * @param creditsEnCours les crédits non soldés — un crédit fini ne se rembourse plus
 */
export function destinationsInternes(etat, creditsEnCours, { entree = false } = {}) {
  const groupes = [
    { groupe: "Épargne", options: etat.placements.map((p) => ({ v: `epargne:${p.id}`, l: p.libelle })) },
    ...(entree ? [] : [
      { groupe: "Projets", options: etat.projets.map((p) => ({ v: `projet:${p.id}`, l: p.libelle })) },
      { groupe: "Crédits", options: creditsEnCours.map((c) => ({ v: `credit:${c.id}`, l: c.libelle })) },
    ]),
  ];
  return groupes.filter((g) => g.options.length > 0);
}

/**
 * Les mouvements internes d'un mois, du plus récent au plus ancien.
 * `sortie` : l'argent a quitté le compte courant (versement, échéance) ;
 * sinon il y est revenu (retrait d'épargne).
 */
export function mouvementsInternesDuMois(etat, mois) {
  const duMois = (m) => moisCle(new Date(m.date)) === mois;
  const liste = [
    ...etat.placements.flatMap((p) => (p.mouvements ?? []).filter(duMois).map((m) => ({
      ...m, nature: "epargne", cible: p, sortie: m.type !== "retrait",
      supprimer: () => api.supprimerMouvement(p.id, m.id),
    }))),
    ...etat.projets.flatMap((p) => (p.versements ?? []).filter(duMois).map((v) => ({
      ...v, nature: "projet", cible: p, sortie: true,
      supprimer: () => api.supprimerVersement(p.id, v.id),
    }))),
    ...etat.credits.flatMap((c) => (c.paiements ?? []).filter(duMois).map((p) => ({
      ...p, nature: "credit", cible: c, sortie: true,
      supprimer: () => api.supprimerPaiement(c.id, p.id),
    }))),
  ];
  return liste.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Ce qu'on lit d'un mouvement quand il n'a pas de libellé propre. */
export const libelleMouvement = (m) =>
  m.libelle || {
    epargne: m.sortie ? `Versement sur ${m.cible.libelle}` : `Retrait de ${m.cible.libelle}`,
    projet: `Versement pour ${m.cible.libelle}`,
    credit: `Échéance ${m.cible.libelle}`,
  }[m.nature];

/** Enregistre un mouvement interne là où il agit. */
export function enregistrerMouvement({ affectation, sortie, montant, pour, date, libelle }) {
  const reperes = { date, ...(libelle ? { libelle } : {}) };
  const { nature, id } = affectation;
  if (nature === "epargne") return api.mouvementer(id, sortie ? "versement" : "retrait", montant, pour, reperes);
  if (nature === "projet") return api.verser(id, montant, pour, reperes);
  return api.payerCredit(id, montant, pour, reperes);
}
