// Mise en page commune des écrans d'authentification.
// Aucun style nouveau : on réutilise les classes de l'application (.bdg, .carte,
// .forme, .champ, .btn, .avis) et on compose le reste en styles en ligne, comme
// le fait déjà le prototype.
import Carte from "../composants/Carte.jsx";

export default function Cadre({ titre, note, erreur, message, children, bas, large, retour, liens }) {
  return (
    <div className="bdg" style={{ minHeight: "100%" }}>
      <div style={{ maxWidth: large ? 720 : 430, margin: "0 auto", padding: "56px 20px 40px" }}>
        <p className="marque" style={{ color: "var(--ardoise)", margin: "0 0 14px" }}>Budget du foyer</p>
        <Carte titre={titre} note={note}>
          <div className="corps">
            {erreur && <div className="avis alerte" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>{erreur}</div>}
            {message && <div className="avis ok" role="status" style={{ marginTop: 0, marginBottom: 14 }}>{message}</div>}
            {children}
            {retour && (
              <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid var(--trait)" }}>
                <Lien onClick={retour}>Retour</Lien>
              </div>
            )}
          </div>
        </Carte>
        {bas && <div style={{ textAlign: "center", marginTop: 4 }}>{bas}</div>}
        {liens && (
          // Les pages légales doivent être atteignables sans compte : c'est
          // souvent avant d'en créer un qu'on veut les lire.
          <div style={{ textAlign: "center", marginTop: 18, display: "flex", justifyContent: "center", gap: 4, flexWrap: "wrap" }}>
            <Lien onClick={() => liens("confidentialite")}>Confidentialité</Lien>
            <span style={{ color: "var(--doux)", alignSelf: "center", fontSize: 12 }}>·</span>
            <Lien onClick={() => liens("mentions-legales")}>Mentions légales</Lien>
          </div>
        )}
      </div>
    </div>
  );
}

// Champs empilés : .forme est horizontale par défaut, .pile la redresse.
// Le redressement passe par une classe et non par un style en ligne, parce que
// l'adaptation mobile de .champ doit pouvoir s'annuler ici : une base flexible
// de 140 px devient une hauteur de 140 px dès que la direction change.
export function Colonne({ children }) {
  return <div className="forme pile">{children}</div>;
}

// Lien discret pour passer d'un écran à l'autre.
export function Lien({ onClick, children }) {
  return (
    <button className="lien" onClick={onClick}>
      {children}
    </button>
  );
}
