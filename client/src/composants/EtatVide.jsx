import Icone from "./Icone.jsx";

/**
 * Ce qu'affiche un écran encore vide : à quoi il sert, et par où commencer.
 * Une liste vide sans bouton laisse chercher où l'on ajoute quelque chose.
 */
export default function EtatVide({ icone, titre, texte, action }) {
  return (
    <div className="etat-vide">
      {icone && (
        <span className="etat-vide-icone">
          <Icone nom={icone} taille={22} />
        </span>
      )}
      <div className="etat-vide-titre">{titre}</div>
      {texte && <p className="etat-vide-texte">{texte}</p>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}
