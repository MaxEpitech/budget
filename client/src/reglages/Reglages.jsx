// Réglages — tout ce qui se configure, à l'écart du budget lui-même.
//
// Avant, un seul onglet « Foyer » empilait les revenus, le partage des
// charges, les accès, la banque, le compte, les connexions, l'export et la
// suppression. Chaque sujet a maintenant sa section, et son adresse : on peut
// envoyer le lien de Réglages › Accès à quelqu'un qu'on aide à s'y retrouver.
import Icone from "../composants/Icone.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { REGLAGES, lienVers } from "../navigation.js";
import Foyer from "./Foyer.jsx";
import Acces from "./Acces.jsx";
import Banque from "./Banque.jsx";
import Compte from "./Compte.jsx";
import Donnees from "./Donnees.jsx";

const GROUPES = ["Foyer", "Vous"];

export default function Reglages({ section, naviguer, etat, calc, executer, modifier, changerRepartition, compte, onDeconnexion, onCompteSupprime, ouvrirPage }) {
  const courant = REGLAGES.find((r) => r.id === section) ?? REGLAGES[0];

  return (
    <>
      <EnTetePage titre="Réglages" description="Le foyer et ses accès, la banque, votre compte et vos données" />

      <div className="reglages">
        <nav className="reglages-nav" aria-label="Sections des réglages">
          {GROUPES.map((g) => (
            <div className="reglages-groupe" key={g}>
              <div className="nav-titre">{g}</div>
              {REGLAGES.filter((r) => r.groupe === g).map((r) => (
                <a key={r.id} className="reglages-lien" aria-current={r.id === courant.id ? "page" : undefined} {...lienVers(r.id, naviguer)}>
                  <Icone nom={r.icone} />
                  <span className="reglages-lien-texte">
                    <span className="reglages-lien-nom">{r.nom}</span>
                    <span className="reglages-lien-desc">{r.description}</span>
                  </span>
                </a>
              ))}
            </div>
          ))}
        </nav>

        <div className="reglages-contenu">
          {courant.id === "foyer" && (
            <Foyer etat={etat} calc={calc} executer={executer} modifier={modifier} changerRepartition={changerRepartition} />
          )}
          {courant.id === "acces" && <Acces membres={etat.membres} />}
          {courant.id === "banque" && <Banque naviguer={naviguer} />}
          {courant.id === "compte" && <Compte compte={compte} onDeconnexion={onDeconnexion} />}
          {courant.id === "donnees" && (
            <Donnees executer={executer} onCompteSupprime={onCompteSupprime} ouvrirPage={ouvrirPage} />
          )}
        </div>
      </div>
    </>
  );
}
