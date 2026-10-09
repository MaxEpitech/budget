import { useEffect, useRef, useId } from "react";
import Icone from "./Icone.jsx";

/**
 * Fenêtre modale, posée sur l'élément <dialog> du navigateur.
 *
 * Les formulaires d'ajout y vivent désormais : affichés en permanence en tête
 * d'écran, ils prenaient la place de ce qu'on venait consulter.
 *
 * Le navigateur fait l'essentiel : le reste de la page devient inerte, Échap
 * referme, et le focus revient au bouton qui l'a ouverte. Un clic sur le voile
 * referme aussi — à condition d'avoir commencé dessus : une sélection de texte
 * qui déborde du cadre ne doit pas faire perdre une saisie.
 */
export default function Dialogue({ ouvert, onFermer, titre, note, children, pied, large }) {
  const ref = useRef(null);
  const appuiSurVoile = useRef(false);
  const idTitre = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (ouvert && !d.open) {
      d.showModal();
      // React n'écrit pas l'attribut autofocus dans le DOM : on place le focus
      // nous-mêmes, sur le premier champ plutôt que sur le bouton de fermeture.
      d.querySelector(".dialogue-corps :is(input, select, textarea):not([disabled]):not([type=hidden])")?.focus();
    }
    if (!ouvert && d.open) d.close();
  }, [ouvert]);

  return (
    <dialog
      ref={ref}
      className={`dialogue${large ? " large" : ""}`}
      aria-labelledby={idTitre}
      onClose={onFermer}
      onMouseDown={(e) => { appuiSurVoile.current = e.target === ref.current; }}
      onClick={(e) => { if (appuiSurVoile.current && e.target === ref.current) onFermer(); }}
    >
      <div className="dialogue-boite">
        <header className="dialogue-tete">
          <div style={{ minWidth: 0 }}>
            <h2 className="dialogue-titre" id={idTitre}>{titre}</h2>
            {note && <p className="dialogue-note">{note}</p>}
          </div>
          <button type="button" className="icone-btn" onClick={onFermer} aria-label="Fermer">
            <Icone nom="fermer" />
          </button>
        </header>
        <div className="dialogue-corps">{children}</div>
        {pied && <footer className="dialogue-pied">{pied}</footer>}
      </div>
    </dialog>
  );
}
