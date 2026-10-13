// Visite guidée : les étapes, le calcul de placement de la bulle, et la mémoire
// de « déjà vue ». Le composant (composants/Tutoriel.jsx) ne fait que les montrer.
//
// Les étapes sont des données : ajouter un écran à la visite, c'est ajouter une
// ligne ici et un attribut data-tutoriel sur l'élément à montrer.
//   page  : identifiant d'un écran de navigation.js ; la visite y navigue
//   cible : valeur de l'attribut data-tutoriel de l'élément éclairé ;
//           sans cible, la bulle est centrée sur l'écran

export const ETAPES = [
  {
    id: "bienvenue",
    titre: "Bienvenue dans votre budget",
    texte: "Cette visite de quelques minutes présente les grandes parties de l'application. Vous pouvez la quitter à tout moment avec « Passer la visite » ou la touche Échap.",
  },
  {
    id: "menu",
    cible: "menu",
    titre: "Le menu",
    texte: "Les écrans sont rangés en trois familles : Budget (opérations, enveloppes, historique), Patrimoine (crédits, projets, épargne) et Simuler (capacité d'emprunt). Sur téléphone, le menu s'ouvre depuis « Plus ».",
  },
  {
    id: "mois",
    page: "accueil",
    cible: "mois",
    titre: "Le mois affiché",
    texte: "Les flèches changent de mois : les écrans du budget et du patrimoine montrent toujours le mois choisi. Le simulateur et les réglages n'en dépendent pas.",
  },
  {
    id: "vue-ensemble",
    page: "accueil",
    cible: "resume",
    titre: "Reste à vivre : prévu et réel",
    texte: "Le prévu vient du budget : revenus moins charges, crédits, projets et épargne. Le réel reprend ce qui est vraiment passé sur les comptes, d'après les opérations datées.",
  },
  {
    id: "operations-ajout",
    page: "operations",
    cible: "ajout-operation",
    titre: "Ajouter une opération",
    texte: "Une dépense, un revenu ou un mouvement interne. Une ligne régulière revient à son rythme (chaque mois, tous les 3, 6 ou 12 mois) et construit le prévu ; une ligne ponctuelle ne compte que dans le mois de sa date.",
  },
  {
    id: "operations-import",
    page: "operations",
    cible: "import-releve",
    titre: "Importer un relevé bancaire",
    texte: "Déposez un fichier CSV, Excel, OFX ou QIF de votre banque, et indiquez à qui appartient le compte. Un aperçu s'affiche, doublons décochés : seules les lignes retenues sont ajoutées.",
  },
  {
    id: "enveloppes",
    page: "enveloppes",
    cible: "page-enveloppes",
    titre: "Les enveloppes",
    texte: "Un plafond mensuel pour chaque catégorie de dépense qui varie, comme les courses ou les loisirs. L'écran montre ce qui est déjà consommé sur ce qui est prévu.",
  },
  {
    id: "credits",
    page: "credits",
    cible: "page-credits",
    titre: "Les crédits",
    texte: "Ce que les emprunts pèsent chaque mois, le capital qu'il reste à rembourser, et ce qu'ils coûtent vraiment en intérêts et en assurance.",
  },
  {
    id: "projets-epargne",
    page: "projets",
    cible: "page-projets",
    titre: "Projets et épargne",
    texte: "Un projet suit ce que vous mettez de côté face à un objectif ; l'écran Épargne liste vos supports, avec leur valeur, leur versement et leur rendement. Les versements mensuels sont déduits du reste à vivre.",
  },
  {
    id: "emprunt",
    page: "emprunt",
    cible: "page-emprunt",
    titre: "Capacité d'emprunt",
    texte: "Estimez ce que le foyer peut emprunter et acheter. Tout se recalcule à la frappe, et rien n'est envoyé au serveur.",
  },
  {
    id: "reglages",
    page: "foyer",
    cible: "reglages-sections",
    titre: "Les réglages",
    texte: "Foyer décrit les personnes, leurs revenus et le partage des charges. Accès gère les comptes et les invitations, Banque la synchronisation et les relevés.",
  },
  {
    id: "compte",
    cible: "menu-compte",
    titre: "Revoir cette visite",
    texte: "Le menu du compte donne accès à votre profil, vos données et la déconnexion. Vous pouvez y relancer cette visite à tout moment avec « Visite guidée ».",
  },
];

/**
 * Où poser la bulle, par rapport à l'élément éclairé.
 *
 * Toutes les mesures sont en pixels, dans le repère de la fenêtre :
 * @param cible  { haut, gauche, largeur, hauteur } de l'élément (marge de
 *               l'éclairage comprise), ou null pour centrer la bulle
 * @param bulle  { largeur, hauteur } de la bulle
 * @param ecran  { largeur, hauteur } de la fenêtre
 * @param marge  distance minimale entre la bulle et le bord de la fenêtre
 * @param ecart  distance entre l'élément et la bulle
 * @returns { haut, gauche, cote } — cote : "dessous", "dessus", "droite" ou "centre"
 *
 * Dessous si ça tient, sinon dessus, sinon à droite (un menu pleine hauteur ne
 * laisse ni haut ni bas) ; à défaut, du côté qui a le plus de place, quitte à
 * recouvrir un peu l'élément : la bulle doit rester lisible avant tout.
 */
export function placerBulle({ cible, bulle, ecran, marge = 16, ecart = 12 }) {
  const borner = (v, min, max) => Math.max(min, Math.min(v, Math.max(min, max)));
  const dansX = (g) => borner(g, marge, ecran.largeur - marge - bulle.largeur);
  const dansY = (h) => borner(h, marge, ecran.hauteur - marge - bulle.hauteur);

  if (!cible) {
    return {
      haut: dansY((ecran.hauteur - bulle.hauteur) / 2),
      gauche: dansX((ecran.largeur - bulle.largeur) / 2),
      cote: "centre",
    };
  }

  const bas = cible.haut + cible.hauteur;
  const droite = cible.gauche + cible.largeur;
  const placeDessous = ecran.hauteur - marge - (bas + ecart);
  const placeDessus = cible.haut - ecart - marge;

  if (placeDessous >= bulle.hauteur) {
    return { haut: bas + ecart, gauche: dansX(cible.gauche), cote: "dessous" };
  }
  if (placeDessus >= bulle.hauteur) {
    return { haut: cible.haut - ecart - bulle.hauteur, gauche: dansX(cible.gauche), cote: "dessus" };
  }
  if (ecran.largeur - marge - (droite + ecart) >= bulle.largeur) {
    return { haut: dansY(cible.haut), gauche: droite + ecart, cote: "droite" };
  }
  return placeDessous >= placeDessus
    ? { haut: dansY(bas + ecart), gauche: dansX(cible.gauche), cote: "dessous" }
    : { haut: dansY(cible.haut - ecart - bulle.hauteur), gauche: dansX(cible.gauche), cote: "dessus" };
}

/* ─── Mémoire de « déjà vue » ───────────────────────────────────────────
   Dans le navigateur, une clé par compte : deux personnes qui partagent un
   appareil ne se privent pas mutuellement de la visite. Le stockage peut être
   indisponible (navigation privée, données bloquées) : tout accès est protégé,
   et sans stockage la visite ne se lance pas d'elle-même — la rejouer à chaque
   chargement serait pire que ne jamais la proposer. Elle reste dans le menu. */

const cleVisite = (email) => `visite-guidee:${email}`;

/** Vrai si la visite doit se lancer seule : stockage lisible, et jamais marquée. */
export function visiteAttendue(email) {
  try {
    return window.localStorage.getItem(cleVisite(email)) === null;
  } catch {
    return false;
  }
}

export function marquerVisiteVue(email) {
  try {
    window.localStorage.setItem(cleVisite(email), "1");
  } catch {
    /* stockage indisponible : la visite restera disponible dans le menu */
  }
}
