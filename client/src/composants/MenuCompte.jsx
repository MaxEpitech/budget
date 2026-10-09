import { useState, useEffect, useRef } from "react";
import Icone from "./Icone.jsx";
import { lienVers } from "../navigation.js";

/**
 * Le compte, en haut à droite, toujours à la même place.
 *
 * Il mène à ce qui concerne la personne connectée — son compte, ses données —
 * et aux réglages du foyer, aux pages légales, et à la sortie. Personne ne va
 * chercher où se déconnecter au fond d'un formulaire de réglages.
 */
export default function MenuCompte({ compte, naviguer, onDeconnexion, ouvrirPage }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef(null);

  // Un menu se referme au clic à côté et à la touche Échap : sans cela il
  // reste ouvert derrière l'écran qu'on vient d'atteindre.
  useEffect(() => {
    if (!ouvert) return;
    const auClic = (e) => { if (!boite.current?.contains(e.target)) setOuvert(false); };
    const auClavier = (e) => { if (e.key === "Escape") setOuvert(false); };
    document.addEventListener("mousedown", auClic);
    document.addEventListener("keydown", auClavier);
    return () => {
      document.removeEventListener("mousedown", auClic);
      document.removeEventListener("keydown", auClavier);
    };
  }, [ouvert]);

  const email = compte?.email ?? "";
  const initiale = email.slice(0, 1) || "?";
  const fermer = () => setOuvert(false);
  const choisir = (action) => () => { fermer(); action(); };

  return (
    <div className="compte" ref={boite}>
      <button
        className="compte-bouton"
        onClick={() => setOuvert(!ouvert)}
        aria-expanded={ouvert}
        aria-haspopup="menu"
        aria-label="Menu du compte"
      >
        <span className="compte-pastille" aria-hidden="true">{initiale}</span>
        <span className="compte-nom">{email}</span>
        <span className="compte-chevron" aria-hidden="true"><Icone nom="bas" taille={14} /></span>
      </button>

      {ouvert && (
        <div className="compte-menu" role="menu">
          <div className="compte-entete">
            <span className="compte-pastille grande" aria-hidden="true">{initiale}</span>
            <div style={{ minWidth: 0 }}>
              <div className="stat-lib">Connecté en tant que</div>
              <div className="compte-mail">{email}</div>
            </div>
          </div>
          <a className="compte-item" role="menuitem" {...lienVers("compte", naviguer, fermer)}>
            <Icone nom="compte" taille={16} /> Mon compte
          </a>
          <a className="compte-item" role="menuitem" {...lienVers("foyer", naviguer, fermer)}>
            <Icone nom="reglages" taille={16} /> Réglages du foyer
          </a>
          <a className="compte-item" role="menuitem" {...lienVers("donnees", naviguer, fermer)}>
            <Icone nom="donnees" taille={16} /> Mes données
          </a>
          <div className="compte-sep" />
          <button className="compte-item" role="menuitem" onClick={choisir(() => ouvrirPage("confidentialite"))}>
            <Icone nom="bouclier" taille={16} /> Confidentialité
          </button>
          <button className="compte-item" role="menuitem" onClick={choisir(() => ouvrirPage("mentions-legales"))}>
            <Icone nom="document" taille={16} /> Mentions légales
          </button>
          <div className="compte-sep" />
          <button className="compte-item sortie" role="menuitem" onClick={choisir(onDeconnexion)}>
            <Icone nom="sortie" taille={16} /> Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
