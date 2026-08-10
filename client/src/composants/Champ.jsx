// Champ de formulaire du prototype, repris à l'identique.
export default function Champ({ libelle, valeur, onChange, largeur = 120, type = "text", options, placeholder, onEntree }) {
  const commun = {
    className: "saisie",
    style: { width: largeur },
    value: valeur,
    onChange: (e) => onChange(e.target.value),
    onKeyDown: (e) => e.key === "Enter" && onEntree && onEntree(),
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
        <input {...commun} type={type} placeholder={placeholder} inputMode={type === "text" ? undefined : "decimal"} />
      )}
    </label>
  );
}
