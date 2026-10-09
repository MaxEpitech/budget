// Champ de formulaire du prototype.
// Le pavé numérique est réservé aux champs de montant ; les champs email et mot
// de passe doivent garder le clavier ordinaire. `attributs` laisse passer ce
// dont les formulaires de connexion ont besoin (autocomplete, autofocus…).
// `classe` s'ajoute au libellé englobant : « plein » lui fait occuper toute la
// ligne d'une grille de formulaire.
const CLAVIER_ORDINAIRE = new Set(["text", "email", "password", "month", "date"]);

export default function Champ({ libelle, valeur, onChange, largeur = 120, type = "text", options, placeholder, onEntree, attributs, disabled, classe }) {
  const commun = {
    className: "saisie",
    style: { width: largeur },
    value: valeur,
    onChange: (e) => onChange(e.target.value),
    onKeyDown: (e) => e.key === "Enter" && onEntree && onEntree(),
    disabled,
  };
  return (
    <label className={classe ? `champ ${classe}` : "champ"}>
      <span className="champ-lib">{libelle}</span>
      {options ? (
        <select {...commun}>
          {/* Une entrée { groupe, options } devient un groupe nommé de la liste. */}
          {options.map((o) =>
            o.groupe ? (
              <optgroup key={o.groupe} label={o.groupe}>
                {o.options.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
              </optgroup>
            ) : (
              <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>
            ),
          )}
        </select>
      ) : (
        <input
          {...commun}
          type={type}
          placeholder={placeholder}
          inputMode={CLAVIER_ORDINAIRE.has(type) ? undefined : "decimal"}
          {...attributs}
        />
      )}
    </label>
  );
}
