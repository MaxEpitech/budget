import { useState } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Dialogue from "./Dialogue.jsx";
import Segments from "./Segments.jsx";
import { num, libelleMois, CATEGORIES } from "../utiles.js";

export const RYTHMES = [
  { cle: "mensuel", nom: "Tous les mois" },
  { cle: "trimestriel", nom: "Tous les 3 mois" },
  { cle: "semestriel", nom: "Tous les 6 mois" },
  { cle: "annuel", nom: "Tous les ans" },
];

const VIERGE = {
  libelle: "", montant: "", categorie: "Courses", pour: "foyer", type: "depense",
  recurrent: true, periodicite: "mensuel", debut: "", fin: "",
};

const MONTANT = { inputMode: "decimal" };

/**
 * Ajouter une dépense ou un revenu, régulier ou ponctuel.
 *
 * Ouvert depuis la vue d'ensemble comme depuis les opérations : c'est le geste
 * le plus fréquent de l'application, il doit être à un clic partout où l'on
 * regarde son mois.
 */
export default function NouvelleOperation({ ouvert, onFermer, etat, mois, executer }) {
  const [f, setF] = useState(VIERGE);
  const valide = f.libelle.trim() && num(f.montant) > 0;

  const ajouter = () => {
    if (!valide) return;
    executer(() =>
      api.creerTransaction({
        type: f.type,
        libelle: f.libelle.trim(),
        montant: num(f.montant),
        categorie: f.categorie,
        pour: f.pour,
        recurrent: f.recurrent,
        mois: f.recurrent ? null : mois,
        periodicite: f.periodicite,
        // Un rythme non mensuel a besoin d'un ancrage ; à défaut, le mois affiché.
        debut: f.recurrent ? (f.debut || (f.periodicite !== "mensuel" ? mois : null)) : null,
        fin: f.recurrent ? (f.fin || null) : null,
      })
    );
    // On garde type, catégorie et rythme : on saisit souvent plusieurs lignes
    // de la même nature d'affilée.
    setF({ ...f, libelle: "", montant: "" });
    onFermer();
  };

  return (
    <Dialogue
      ouvert={ouvert}
      onFermer={onFermer}
      titre="Nouvelle opération"
      note={f.recurrent ? "Saisie une fois, elle revient d'elle-même" : `Comptée en ${libelleMois(mois).toLowerCase()} uniquement`}
      pied={
        <>
          <button className="btn fant" onClick={onFermer}>Annuler</button>
          <button className="btn" onClick={ajouter} disabled={!valide}>Ajouter</button>
        </>
      }
    >
      <Segments
        plein libelle="Nature de l'opération" valeur={f.type} onChange={(v) => setF({ ...f, type: v })}
        options={[{ v: "depense", l: "Dépense" }, { v: "revenu", l: "Revenu" }]}
      />
      <div className="grille-form">
        <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%"
          placeholder={f.type === "revenu" ? "Ex. Prime, location" : "Ex. Internet, loyer"} onEntree={ajouter} />
        <Champ libelle="Montant (€)" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur="100%"
          placeholder="0" onEntree={ajouter} attributs={MONTANT} />
        <Champ libelle="Catégorie" valeur={f.categorie} onChange={(v) => setF({ ...f, categorie: v })} largeur="100%" options={CATEGORIES} />
        <Champ classe="plein" libelle="Pour qui" valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur="100%"
          options={[{ v: "foyer", l: "Le foyer (charge commune)" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
        <label className="bascule plein">
          <input type="checkbox" checked={f.recurrent} onChange={(e) => setF({ ...f, recurrent: e.target.checked })} />
          Revient régulièrement
        </label>
        {f.recurrent && (
          <>
            <Champ classe="plein" libelle="Rythme" valeur={f.periodicite} onChange={(v) => setF({ ...f, periodicite: v })} largeur="100%"
              options={RYTHMES.map((r) => ({ v: r.cle, l: r.nom }))} />
            <Champ libelle={f.periodicite === "mensuel" ? "Depuis (facultatif)" : "1er prélèvement"}
              valeur={f.debut} onChange={(v) => setF({ ...f, debut: v })} largeur="100%" type="month" />
            <Champ libelle="Jusqu'à (facultatif)" valeur={f.fin} onChange={(v) => setF({ ...f, fin: v })} largeur="100%" type="month" />
          </>
        )}
      </div>
      {f.recurrent && f.periodicite !== "mensuel" && (
        <div className="carte-note" style={{ marginTop: 12 }}>
          Le montant est celui d'une échéance : une assurance annuelle de 240 € pèse 240 € sur
          le mois où elle est prélevée, pas 20 € tous les mois.
        </div>
      )}
    </Dialogue>
  );
}
