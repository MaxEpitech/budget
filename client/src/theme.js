// Apparence : suivre le réglage du système, ou forcer le clair ou le sombre.
//
// Les deux thèmes existent déjà dans styles.css ; ce module ne fait que poser
// data-theme sur la racine. Le choix est propre à l'appareil — on peut vouloir
// le sombre sur son téléphone et le clair au bureau — et vit donc dans le
// navigateur, pas dans le compte.
const CLE = "budget:theme";

export const THEMES = [
  { v: "systeme", l: "Système" },
  { v: "clair", l: "Clair" },
  { v: "sombre", l: "Sombre" },
];

export function lireTheme() {
  try {
    const t = window.localStorage.getItem(CLE);
    return THEMES.some((x) => x.v === t) ? t : "systeme";
  } catch {
    return "systeme";
  }
}

export function appliquerTheme(theme) {
  const racine = document.documentElement;
  if (theme === "clair") racine.dataset.theme = "light";
  else if (theme === "sombre") racine.dataset.theme = "dark";
  else delete racine.dataset.theme;
}

export function choisirTheme(theme) {
  appliquerTheme(theme);
  try {
    window.localStorage.setItem(CLE, theme);
  } catch {
    // Navigation privée : le choix vaut pour la session, c'est déjà ça.
  }
}
