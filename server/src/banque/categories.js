// Devine la catégorie d'une opération d'après son libellé.
//
// Une proposition, rien de plus : l'aperçu de l'import laisse la corriger ligne
// par ligne. Les catégories sont celles de l'onglet Flux.
import { normaliser } from "./analyse.js";

export const CATEGORIE_PAR_DEFAUT = "Autre";

// L'ordre compte : la première règle qui reconnaît le libellé l'emporte. Les
// plus précises passent donc avant — « totalenergies » avant « total ».
const REGLES = [
  ["Impôts", ["impot", "dgfip", "tresor public", "taxe fonciere", "taxe habitation", "urssaf"]],
  ["Assurances", ["assurance", "maif", "macif", "matmut", "groupama", "allianz", "axa ", "mma ", "mutuelle"]],
  ["Énergie", ["totalenergies", "edf", "engie", "electricite", "gaz ", "veolia", "suez", "eau de ", "ekwateur"]],
  ["Logement", ["loyer", "syndic", "foncia", "copropriete", "charges locatives", "pret immo", "credit immo"]],
  ["Abonnements", ["netflix", "spotify", "deezer", "disney", "canal+", "canal plus", "prime video", "free mobile", "freebox", "bouygues", "sfr", "orange", "sosh", "abonnement"]],
  ["Enfants", ["creche", "cantine", "garderie", "nounou", "ecole", "periscolaire", "centre de loisirs"]],
  ["Santé", ["pharmacie", "medecin", "docteur", "dentiste", "laboratoire", "hopital", "clinique", "opticien", "kine", "cpam"]],
  ["Transport", ["sncf", "ratp", "navigo", "peage", "autoroute", "parking", "station", "carburant", "essence", "total", "uber", "blablacar", "garage"]],
  ["Courses", ["carrefour", "leclerc", "auchan", "lidl", "aldi", "intermarche", "monoprix", "franprix", "casino", "super u", "hyper u", "picard", "biocoop", "boulangerie", "marche"]],
  ["Loisirs", ["cinema", "theatre", "restaurant", "brasserie", "fnac", "decathlon", "librairie", "musee", "concert"]],
];

/** La catégorie la plus probable pour ce libellé ; « Autre » faute d'indice. */
export function devinerCategorie(libelle) {
  // Encadré d'espaces : « axa » ne doit pas se reconnaître dans « relaxation ».
  const texte = ` ${normaliser(libelle)} `;
  for (const [categorie, mots] of REGLES) {
    if (mots.some((mot) => texte.includes(mot.endsWith(" ") ? ` ${mot}` : mot))) return categorie;
  }
  return CATEGORIE_PAR_DEFAUT;
}
