// Champ de formulaire du prototype.
// Le pavé numérique est réservé aux champs de montant ; les champs email et mot
// de passe doivent garder le clavier ordinaire. `attributs` laisse passer ce
// dont les formulaires de connexion ont besoin (autocomplete, autofocus…).
const CLAVIER_ORDINAIRE = new Set(["text", "email", "password", "month"]);

export default function Champ({ libelle, valeur, onChange, largeur = 120, type = "text", options, placeholder, onEntree, attributs, disabled }) {
  const commun = {
    className: "saisie",
    style: { width: largeur },
    value: valeur,
    onChange: (e) => onChange(e.target.value),
    onKeyDown: (e) => e.key === "Enter" && onEntree && onEntree(),
    disabled,
  };
  return (
    <label className="champ">
      <span className="champ-lib">{libelle}</span>
      {options ? (
        <select {...commun}>
          {options.map((o) => (
            <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>
          ))}
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
