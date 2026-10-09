import { useState, useEffect } from "react";
import Icone from "./Icone.jsx";
import MenuCompte from "./MenuCompte.jsx";
import { PAGES, lienVers } from "../navigation.js";
import { euro, decalerMois, libelleMois, moisCle } from "../utiles.js";

/**
 * Le cadre de l'application : le menu, la barre du haut, et l'écran courant.
 *
 * Sur grand écran, le menu est une colonne fixe, rangée par familles — ce
 * qu'on suit chaque mois, ce qu'on possède ou doit, ce qu'on simule. Sur
 * téléphone, il devient un tiroir, et les quatre écrans les plus fréquentés
 * restent sous le pouce dans une barre en bas.
 *
 * Le sélecteur de mois n'apparaît que sur les écrans qui dépendent du mois :
 * feuilleter les mois depuis le simulateur ou les réglages ne changerait rien,
 * et laisserait croire le contraire.
 */
const GROUPES = [null, "Budget", "Patrimoine", "Simuler"];

// Au doigt : quatre destinations directes, le reste est dans le tiroir.
const RACCOURCIS = [
  { id: "accueil", nom: "Accueil" },
  { id: "operations", nom: "Opérations" },
  { id: "enveloppes", nom: "Enveloppes" },
  { id: "projets", nom: "Projets" },
];

function SelecteurMois({ mois, setMois }) {
  const courant = moisCle();
  return (
    <div className="mois">
      <div className="mois-nav">
        <button className="fleche" onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent">
          <Icone nom="gauche" taille={16} />
        </button>
        <span className="mois-titre chiffre" aria-live="polite">{libelleMois(mois)}</span>
        <button className="fleche" onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">
          <Icone nom="droite" taille={16} />
        </button>
      </div>
      {mois !== courant && (
        <button className="mois-retour" onClick={() => setMois(courant)}>Ce mois-ci</button>
      )}
    </div>
  );
}

export default function Coquille({ route, naviguer, compte, mois, setMois, reste, reel, occupe, onDeconnexion, ouvrirPage, children }) {
  const [tiroir, setTiroir] = useState(false);

  // Le titre de l'onglet du navigateur suit l'écran : l'historique et les
  // favoris deviennent lisibles.
  useEffect(() => {
    document.title = route.id === "accueil" ? "Budget du foyer" : `${route.reglages ? "Réglages · " : ""}${route.nom} · Budget du foyer`;
  }, [route]);

  // Le tiroir ouvert : Échap le referme, et la page derrière ne défile plus.
  useEffect(() => {
    if (!tiroir) return undefined;
    const auClavier = (e) => e.key === "Escape" && setTiroir(false);
    document.addEventListener("keydown", auClavier);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", auClavier);
      document.body.style.overflow = "";
    };
  }, [tiroir]);

  const fermerTiroir = () => setTiroir(false);

  const lien = (p) => (
    <a
      key={p.id}
      className="nav-lien"
      aria-current={!route.reglages && route.id === p.id ? "page" : undefined}
      {...lienVers(p.id, naviguer, fermerTiroir)}
    >
      <Icone nom={p.icone} />
      <span>{p.nom}</span>
    </a>
  );

  return (
    <div className="app">
      <a className="lien-evitement" href="#contenu">Aller au contenu</a>

      <aside className="lateral" data-ouvert={tiroir ? "1" : "0"} aria-label="Navigation principale">
        <div className="lateral-tete">
          <a className="marque-app" {...lienVers("accueil", naviguer, fermerTiroir)}>
            <span className="marque-logo" aria-hidden="true">€</span>
            Budget du foyer
          </a>
          <button className="icone-btn lateral-fermer" onClick={fermerTiroir} aria-label="Fermer le menu">
            <Icone nom="fermer" />
          </button>
        </div>
        <nav className="lateral-nav">
          {GROUPES.map((g) => (
            <div className="nav-groupe" key={g ?? "racine"}>
              {g && <div className="nav-titre">{g}</div>}
              {PAGES.filter((p) => p.groupe === g).map(lien)}
            </div>
          ))}
        </nav>
        <div className="lateral-pied">
          <a
            className="nav-lien"
            aria-current={route.reglages ? "page" : undefined}
            {...lienVers("foyer", naviguer, fermerTiroir)}
          >
            <Icone nom="reglages" />
            <span>Réglages</span>
          </a>
        </div>
      </aside>
      {tiroir && <div className="voile" onClick={fermerTiroir} aria-hidden="true" />}

      <div className="principal">
        <header className="barre">
          <button className="icone-btn barre-menu" onClick={() => setTiroir(true)} aria-label="Ouvrir le menu">
            <Icone nom="menu" />
          </button>
          {route.mensuel ? (
            <SelecteurMois mois={mois} setMois={setMois} />
          ) : (
            <span className="barre-titre">{route.reglages ? "Réglages" : route.nom}</span>
          )}
          <div className="barre-droite">
            {/* Le reste à vivre suit partout où le mois compte : c'est le
                chiffre qu'on vient chercher. La vue d'ensemble l'affiche déjà
                en grand. */}
            {route.mensuel && route.id !== "accueil" && reste != null && (
              <a className={`pilule-reste${reste < 0 ? " neg" : ""}`} {...lienVers("accueil", naviguer)}
                title="Reste à vivre prévu par le budget, et réel d'après les opérations enregistrées">
                <span>Prévu</span>
                <strong className="chiffre">{euro(reste)}</strong>
                {reel?.operations > 0 && (
                  <>
                    <span className="pilule-sep" aria-hidden="true" />
                    <span>Réel</span>
                    <strong className={`chiffre${reel.reste < 0 ? " neg" : ""}`}>{euro(reel.reste)}</strong>
                  </>
                )}
              </a>
            )}
            <MenuCompte compte={compte} naviguer={naviguer} onDeconnexion={onDeconnexion} ouvrirPage={ouvrirPage} />
          </div>
          {occupe && <div className="barre-progression" aria-hidden="true" />}
        </header>

        <main className="contenu" id="contenu" tabIndex={-1} data-occupe={occupe ? "1" : "0"}>
          {children}
        </main>
      </div>

      <nav className="nav-bas" aria-label="Navigation rapide">
        {RACCOURCIS.map((r) => {
          const p = PAGES.find((x) => x.id === r.id);
          return (
            <a key={r.id} className="nav-bas-lien" aria-current={!route.reglages && route.id === r.id ? "page" : undefined} {...lienVers(r.id, naviguer)}>
              <Icone nom={p.icone} taille={20} />
              <span>{r.nom}</span>
            </a>
          );
        })}
        <button className="nav-bas-lien" onClick={() => setTiroir(true)} aria-expanded={tiroir}>
          <Icone nom="menu" taille={20} />
          <span>Plus</span>
        </button>
      </nav>
    </div>
  );
}
