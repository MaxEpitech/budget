// Navigation de l'application : une adresse par écran.
//
// Pas de bibliothèque de routage : une table, l'API History du navigateur, et
// un hook. Chaque écran a son adresse — on peut la recharger, la garder en
// favori, l'ouvrir dans un nouvel onglet, et le bouton « précédent » ramène là
// où l'on était. Vercel sert index.html pour toute adresse inconnue : rien à
// déclarer côté hébergement.
import { useState, useEffect, useCallback } from "react";

/**
 * Les écrans du budget, dans l'ordre du menu.
 * `mensuel` : l'écran dépend du mois affiché — le sélecteur de mois n'apparaît
 * que sur eux. Le simulateur et les réglages n'ont rien à faire d'un mois.
 */
export const PAGES = [
  { id: "accueil", chemin: "/", nom: "Vue d'ensemble", icone: "accueil", groupe: null, mensuel: true },
  { id: "operations", chemin: "/operations", nom: "Opérations", icone: "operations", groupe: "Budget", mensuel: true },
  { id: "enveloppes", chemin: "/enveloppes", nom: "Enveloppes", icone: "enveloppes", groupe: "Budget", mensuel: true },
  { id: "historique", chemin: "/historique", nom: "Historique", icone: "historique", groupe: "Budget", mensuel: true },
  { id: "credits", chemin: "/credits", nom: "Crédits", icone: "credits", groupe: "Patrimoine", mensuel: true },
  { id: "projets", chemin: "/projets", nom: "Projets", icone: "projets", groupe: "Patrimoine", mensuel: true },
  { id: "epargne", chemin: "/epargne", nom: "Épargne", icone: "epargne", groupe: "Patrimoine", mensuel: true },
  { id: "emprunt", chemin: "/capacite-emprunt", nom: "Capacité d'emprunt", icone: "capacite", groupe: "Simuler", mensuel: false },
];

/**
 * Les sections des réglages. Le foyer d'un côté — ce qui se partage entre
 * tous ses comptes —, la personne connectée de l'autre.
 */
export const REGLAGES = [
  { id: "foyer", chemin: "/reglages/foyer", nom: "Foyer", description: "Personnes, revenus, partage", icone: "foyer", groupe: "Foyer" },
  { id: "acces", chemin: "/reglages/acces", nom: "Accès", description: "Comptes et invitations", icone: "acces", groupe: "Foyer" },
  { id: "banque", chemin: "/reglages/banque", nom: "Banque", description: "Synchronisation, relevés", icone: "banque", groupe: "Foyer" },
  { id: "compte", chemin: "/reglages/compte", nom: "Mon compte", description: "Profil, sécurité, apparence", icone: "compte", groupe: "Vous" },
  { id: "donnees", chemin: "/reglages/donnees", nom: "Données", description: "Export, remise à zéro, suppression", icone: "donnees", groupe: "Vous" },
];

const ACCUEIL = { ...PAGES[0], reglages: false };

const normaliser = (chemin) => chemin.replace(/\/+$/, "") || "/";

/** L'écran que désigne une adresse, ou null si elle n'en désigne aucun. */
export function resoudre(chemin) {
  const c = normaliser(chemin);
  const page = PAGES.find((p) => p.chemin === c);
  if (page) return { ...page, reglages: false };
  // « /reglages » tout court ouvre la première section.
  const reglage = c === "/reglages" ? REGLAGES[0] : REGLAGES.find((r) => r.chemin === c);
  if (reglage) return { ...reglage, mensuel: false, reglages: true };
  return null;
}

/** Retrouve un écran par son identifiant — ils sont uniques, réglages compris. */
export const ecran = (id) => resoudre(PAGES.find((p) => p.id === id)?.chemin ?? REGLAGES.find((r) => r.id === id)?.chemin ?? "/");

export const estCheminApp = (chemin) => resoudre(chemin) !== null;

/**
 * L'écran courant, et de quoi en changer.
 *
 * @param initial  identifiant imposé au premier rendu — le retour de la banque
 *   arrive sur une adresse qui n'est pas celle d'un écran, et doit ouvrir le
 *   simulateur sans que l'adresse soit touchée : elle porte encore le code que
 *   la banque y a laissé.
 */
export function useNavigation(initial) {
  const [route, setRoute] = useState(() => {
    if (initial) return ecran(initial);
    const r = resoudre(window.location.pathname);
    if (r) return r;
    window.history.replaceState({}, "", "/");
    return ACCUEIL;
  });

  useEffect(() => {
    const surRetour = () => setRoute(resoudre(window.location.pathname) ?? ACCUEIL);
    window.addEventListener("popstate", surRetour);
    return () => window.removeEventListener("popstate", surRetour);
  }, []);

  const naviguer = useCallback((id) => {
    const cible = ecran(id);
    if (normaliser(window.location.pathname) !== cible.chemin || window.location.search) {
      window.history.pushState({}, "", cible.chemin);
    }
    setRoute(cible);
    window.scrollTo(0, 0);
  }, []);

  return [route, naviguer];
}

/**
 * Props d'un lien interne : une vraie adresse, pour que le clic du milieu et
 * « ouvrir dans un nouvel onglet » fonctionnent, mais un clic ordinaire reste
 * dans l'application sans recharger la page.
 */
export const lienVers = (id, naviguer, apres) => ({
  href: ecran(id).chemin,
  onClick: (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    naviguer(id);
    apres?.();
  },
});
