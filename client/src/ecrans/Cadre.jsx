// Mise en page commune des écrans d'authentification.
//
// Sur grand écran, le formulaire est accompagné d'une présentation de
// l'application : c'est souvent la première chose qu'on en voit. Les pages
// longues (`large` : pages légales) gardent une seule colonne, faite pour lire.
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";

const ATOUTS = [
  { icone: "operations", texte: "Dépenses, revenus, crédits, épargne et projets au même endroit" },
  { icone: "foyer", texte: "Les charges communes réparties entre les membres du foyer" },
  { icone: "bouclier", texte: "Vos données vous appartiennent : exportables et supprimables à tout moment" },
];

function Marque() {
  return (
    <div className="marque-app">
      <span className="marque-logo" aria-hidden="true">€</span>
      Budget du foyer
    </div>
  );
}

export default function Cadre({ titre, note, erreur, message, children, bas, large, retour, liens }) {
  const formulaire = (
    <>
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
    </>
  );

  if (large) {
    return (
      <div className="bdg auth-page">
        <div className="auth-lecture">
          {/* Même marque qu'une fois connecté : on doit reconnaître où l'on est. */}
          <div className="auth-marque"><Marque /></div>
          {formulaire}
        </div>
      </div>
    );
  }

  return (
    <div className="bdg auth-page">
      <div className="auth">
        <aside className="auth-vitrine" aria-hidden="true">
          <Marque />
          <div>
            <p className="auth-accroche">Le budget du foyer, clair pour tout le monde.</p>
            <ul className="auth-atouts">
              {ATOUTS.map((a) => (
                <li key={a.icone}>
                  <span className="auth-atout-icone"><Icone nom={a.icone} /></span>
                  {a.texte}
                </li>
              ))}
            </ul>
          </div>
          <div className="auth-bande">
            {/* La bande de la vue d'ensemble, en filigrane. */}
            <span style={{ width: "38%", opacity: 0.9 }} />
            <span style={{ width: "18%", opacity: 0.6 }} />
            <span style={{ width: "10%", opacity: 0.45 }} />
            <span style={{ width: "9%", opacity: 0.32 }} />
            <span style={{ width: "25%", opacity: 0.2 }} />
          </div>
        </aside>
        <main className="auth-formulaire">
          <div className="auth-marque mobile"><Marque /></div>
          <div className="auth-colonne">{formulaire}</div>
        </main>
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
