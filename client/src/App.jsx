// Aiguillage de l'application : écrans d'authentification tant qu'aucun compte
// n'est connecté, budget ensuite.
//
// Pas de routeur : deux chemins seulement viennent de l'extérieur, ceux des
// liens envoyés par email. Ils sont lus une fois au chargement, puis l'URL est
// nettoyée — un jeton n'a rien à faire dans la barre d'adresse une fois consommé.
import { useState, useEffect, useCallback } from "react";
import { api } from "./api.js";
import Budget from "./Budget.jsx";
import Cadre from "./ecrans/Cadre.jsx";
import Connexion from "./ecrans/Connexion.jsx";
import Inscription from "./ecrans/Inscription.jsx";
import BoiteMail from "./ecrans/BoiteMail.jsx";
import Validation from "./ecrans/Validation.jsx";
import MotDePasseOublie from "./ecrans/MotDePasseOublie.jsx";
import NouveauMotDePasse from "./ecrans/NouveauMotDePasse.jsx";
import Invitation from "./ecrans/Invitation.jsx";
import { Confidentialite, MentionsLegales } from "./ecrans/PagesLegales.jsx";
import "./styles.css";

// Pages atteignables directement par leur adresse : les liens reçus par email,
// et les pages légales — qu'on doit pouvoir lire, et partager, sans compte.
const PAGES_PUBLIQUES = { "/confidentialite": "confidentialite", "/mentions-legales": "mentions-legales" };

function ecranInitial() {
  const jeton = new URLSearchParams(window.location.search).get("jeton");
  const chemin = window.location.pathname.replace(/\/+$/, "");
  if (jeton && chemin === "/valider") return { nom: "validation", jeton };
  if (jeton && chemin === "/reinitialiser") return { nom: "nouveau-mot-de-passe", jeton };
  if (jeton && chemin === "/invitation") return { nom: "invitation", jeton };
  if (PAGES_PUBLIQUES[chemin]) return { nom: PAGES_PUBLIQUES[chemin] };
  return { nom: "connexion" };
}

// Retire le jeton de la barre d'adresse sans recharger la page.
const nettoyerUrl = () => {
  if (window.location.pathname !== "/" || window.location.search) {
    window.history.replaceState({}, "", "/");
  }
};

export default function App() {
  // undefined : on ne sait pas encore · null : déconnecté · objet : connecté
  const [compte, setCompte] = useState(undefined);
  const [ecran, setEcran] = useState(ecranInitial);

  // Une session déjà ouverte évite de redemander à se connecter à chaque visite.
  useEffect(() => {
    let vivant = true;
    api.moi().then(
      (profil) => vivant && setCompte(profil),
      () => vivant && setCompte(null)
    );
    return () => { vivant = false; };
  }, []);

  const connecter = useCallback((profil) => {
    nettoyerUrl();
    // Indispensable : les écrans venant d'un lien email sont rendus avant même
    // qu'on regarde le compte. Sans quitter cet écran, la session s'ouvrirait
    // sans que l'affichage bouge.
    setEcran({ nom: "connexion" });
    setCompte(profil);
  }, []);

  const allerVers = useCallback((nom) => {
    nettoyerUrl();
    setEcran({ nom });
  }, []);

  const deconnecter = async () => {
    try {
      await api.deconnexion();
    } catch {
      // Session déjà close côté serveur : le résultat voulu est atteint.
    }
    setCompte(null);
    setEcran({ nom: "connexion" });
  };

  // La session est tombée pendant l'utilisation : on repasse à la connexion.
  const sessionExpiree = useCallback(() => {
    setCompte(null);
    setEcran({ nom: "connexion" });
  }, []);

  // Les liens reçus par email s'ouvrent quel que soit l'état de la session :
  // confirmer une adresse ou changer un mot de passe doit rester possible même
  // en étant déjà connecté ailleurs.
  if (ecran.nom === "validation") {
    return <Validation jeton={ecran.jeton} onConnecte={connecter} allerVers={allerVers} />;
  }
  if (ecran.nom === "nouveau-mot-de-passe") {
    return <NouveauMotDePasse jeton={ecran.jeton} onConnecte={connecter} allerVers={allerVers} />;
  }
  // Une invitation s'ouvre aussi quand on est déjà connecté : c'est justement
  // le cas où un compte existant rejoint un autre foyer.
  if (ecran.nom === "invitation") {
    return <Invitation jeton={ecran.jeton} onConnecte={connecter} allerVers={allerVers} />;
  }
  // Les pages légales s'affichent qu'on soit connecté ou non : on doit pouvoir
  // les consulter avant de créer un compte, comme après.
  if (ecran.nom === "confidentialite") return <Confidentialite allerVers={allerVers} />;
  if (ecran.nom === "mentions-legales") return <MentionsLegales allerVers={allerVers} />;

  if (compte === undefined) {
    return (
      <Cadre titre="Budget du foyer">
        <p style={{ margin: 0 }}>Chargement…</p>
      </Cadre>
    );
  }

  if (compte) {
    return <Budget compte={compte} onDeconnexion={deconnecter} onSessionExpiree={sessionExpiree} ouvrirPage={allerVers} />;
  }

  if (ecran.nom === "inscription") {
    return (
      <Inscription
        allerVers={allerVers}
        onConnecte={connecter}
        onEmailEnvoye={(email) => setEcran({ nom: "boite-mail", email })}
      />
    );
  }
  if (ecran.nom === "boite-mail") {
    return <BoiteMail email={ecran.email} allerVers={allerVers} />;
  }
  if (ecran.nom === "mot-de-passe-oublie") {
    return <MotDePasseOublie allerVers={allerVers} />;
  }
  return <Connexion onConnecte={connecter} allerVers={allerVers} />;
}
