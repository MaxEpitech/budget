/**
 * Choix exclusif entre quelques options, toutes visibles d'un coup.
 *
 * Remplace la liste déroulante quand il n'y a que deux ou trois possibilités :
 * on voit ce qui est choisi et ce qui ne l'est pas sans avoir à ouvrir quoi
 * que ce soit.
 */
export default function Segments({ valeur, onChange, options, libelle, plein, disabled }) {
  return (
    <div className={`segments${plein ? " plein" : ""}`} role="group" aria-label={libelle}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          className="segment"
          aria-pressed={valeur === o.v}
          disabled={disabled}
          onClick={() => valeur !== o.v && onChange(o.v)}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}
