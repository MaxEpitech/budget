import { useState, useEffect, useRef } from "react";

/**
 * Le compte, en haut à droite, toujours à la même place.
 *
 * Se déconnecter était jusqu'ici enterré au bas de l'onglet Foyer : personne
 * ne va chercher une sortie dans un formulaire de réglages. Le menu réunit ce
 * qui concerne le compte plutôt que le budget — l'identité, les réglages du
 * foyer, les pages légales, et la sortie.
 */
export default function MenuCompte({ compte, onReglages, onDeconnexion, ouvrirPage }) {
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

  const choisir = (action) => () => { setOuvert(false); action(); };

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
        <span className="compte-chevron" aria-hidden="true">▾</span>
      </button>

      {ouvert && (
        <div className="compte-menu" role="menu">
          <div className="compte-entete">
            <div className="stat-lib">Connecté en tant que</div>
            <div className="compte-mail">{email}</div>
          </div>
          <button className="compte-item" role="menuitem" onClick={choisir(onReglages)}>
            Réglages du foyer
          </button>
          <button className="compte-item" role="menuitem" onClick={choisir(() => ouvrirPage("confidentialite"))}>
            Politique de confidentialité
          </button>
          <button className="compte-item" role="menuitem" onClick={choisir(() => ouvrirPage("mentions-legales"))}>
            Mentions légales
          </button>
          <div className="compte-sep" />
          <button className="compte-item sortie" role="menuitem" onClick={choisir(onDeconnexion)}>
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
