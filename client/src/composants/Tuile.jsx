import Icone from "./Icone.jsx";

/**
 * Un chiffre clé, son libellé et un mot d'explication.
 *
 * La teinte est celle du poste concerné — la même que dans la bande de la vue
 * d'ensemble — et passe par --teinte. Cliquable quand `onClick` est fourni :
 * elle mène alors à l'écran qui détaille ce chiffre.
 */
export default function Tuile({ libelle, valeur, note, teinte, icone, onClick, couleurValeur }) {
  const contenu = (
    <>
      <div className="tuile-haut">
        {icone && (
          <span className="tuile-icone">
            <Icone nom={icone} taille={16} />
          </span>
        )}
        <span className="tuile-lib">{libelle}</span>
        {onClick && <span className="tuile-fleche"><Icone nom="droite" taille={16} /></span>}
      </div>
      <div className="tuile-val chiffre" style={couleurValeur ? { color: couleurValeur } : undefined}>{valeur}</div>
      {note && <div className="tuile-note">{note}</div>}
    </>
  );
  const style = teinte ? { "--teinte": teinte } : undefined;
  return onClick ? (
    <button type="button" className="tuile cliquable" style={style} onClick={onClick}>{contenu}</button>
  ) : (
    <div className="tuile" style={style}>{contenu}</div>
  );
}
