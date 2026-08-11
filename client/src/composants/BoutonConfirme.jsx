import { useState, useEffect } from "react";

/**
 * Bouton qui demande confirmation avant d'agir, sur place.
 *
 * Pas de boîte de dialogue du navigateur : elle s'affiche hors du contexte, on
 * la referme sans lire, et son apparence n'a rien à voir avec le reste. Ici le
 * bouton se transforme, à l'endroit même où l'on vient de cliquer.
 *
 * L'armement retombe seul au bout de quelques secondes : une action destructrice
 * ne doit pas rester amorcée derrière soi.
 */
const DELAI_DESARMEMENT = 6000;

export default function BoutonConfirme({ libelle, confirmation = "Confirmer", onConfirme, disabled }) {
  const [arme, setArme] = useState(false);

  useEffect(() => {
    if (!arme) return undefined;
    const minuterie = setTimeout(() => setArme(false), DELAI_DESARMEMENT);
    return () => clearTimeout(minuterie);
  }, [arme]);

  if (!arme) {
    return (
      <button className="btn fant mini" disabled={disabled} onClick={() => setArme(true)}>
        {libelle}
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        className="btn mini"
        disabled={disabled}
        onClick={() => {
          setArme(false);
          onConfirme();
        }}
      >
        {confirmation}
      </button>
      <button className="btn fant mini" onClick={() => setArme(false)}>
        Annuler
      </button>
    </span>
  );
}
