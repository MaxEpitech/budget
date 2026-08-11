// Mise en page commune des écrans d'authentification.
// Aucun style nouveau : on réutilise les classes de l'application (.bdg, .carte,
// .forme, .champ, .btn, .avis) et on compose le reste en styles en ligne, comme
// le fait déjà le prototype.
import Carte from "../composants/Carte.jsx";

export default function Cadre({ titre, note, erreur, message, children, bas }) {
  return (
    <div className="bdg" style={{ minHeight: "100%" }}>
      <div style={{ maxWidth: 430, margin: "0 auto", padding: "56px 20px 40px" }}>
        <p className="marque" style={{ color: "var(--ardoise)", margin: "0 0 14px" }}>Budget du foyer</p>
        <Carte titre={titre} note={note}>
          <div className="corps">
            {erreur && <div className="avis alerte" role="alert" style={{ marginTop: 0, marginBottom: 14 }}>{erreur}</div>}
            {message && <div className="avis ok" role="status" style={{ marginTop: 0, marginBottom: 14 }}>{message}</div>}
            {children}
          </div>
        </Carte>
        {bas && <div style={{ textAlign: "center", marginTop: 4 }}>{bas}</div>}
      </div>
    </div>
  );
}

// Champs empilés : .forme est horizontale par défaut, on la redresse ici.
export function Colonne({ children }) {
  return (
    <div className="forme" style={{ flexDirection: "column", alignItems: "stretch", gap: 12 }}>
      {children}
    </div>
  );
}

// Lien discret pour passer d'un écran à l'autre.
export function Lien({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{ fontSize: 13, color: "var(--indigo)", textDecoration: "underline", padding: "6px 4px" }}
    >
      {children}
    </button>
  );
}
