// Utilitaires du prototype, repris à l'identique.

export const euro = (n) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

export const euroPrecis = (n) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

export const num = (v) => {
  const n = parseFloat(String(v).replace(",", ".").replace(/\s/g, ""));
  return isNaN(n) ? 0 : n;
};

export const moisCle = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const decalerMois = (cle, delta) => {
  const [a, m] = cle.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return moisCle(d);
};

export const ecartMois = (de, vers) => {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = vers.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

export const libelleMois = (cle) => {
  const [a, m] = cle.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Date d'un versement : « 10 août 2026 ».
export const libelleDate = (iso) =>
  new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// « il y a trois minutes », « hier » : une date exacte n'apprend rien quand on
// cherche seulement à reconnaître sa propre connexion.
export const ilYA = (iso) => {
  const secondes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secondes < 60) return "à l'instant";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `il y a ${minutes} minute${minutes > 1 ? "s" : ""}`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `il y a ${heures} heure${heures > 1 ? "s" : ""}`;
  const jours = Math.round(heures / 24);
  if (jours < 31) return `il y a ${jours} jour${jours > 1 ? "s" : ""}`;
  return `le ${libelleDate(iso)}`;
};

export const CATEGORIES = ["Logement", "Courses", "Transport", "Énergie", "Abonnements", "Santé", "Loisirs", "Enfants", "Assurances", "Impôts", "Autre"];

export const POSTES = {
  depenses: { nom: "Dépenses", var: "--ardoise" },
  credits: { nom: "Crédits", var: "--brique" },
  projets: { nom: "Projets", var: "--ocre" },
  placements: { nom: "Épargne", var: "--indigo" },
  reste: { nom: "Reste à vivre", var: "--caisse" },
};
