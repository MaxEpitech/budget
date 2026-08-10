// Carte de contenu du prototype, reprise à l'identique.
export default function Carte({ titre, note, action, children }) {
  return (
    <section className="carte">
      {(titre || action) && (
        <div className="carte-tete">
          <div>
            <div className="carte-titre">{titre}</div>
            {note && <div className="carte-note">{note}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
