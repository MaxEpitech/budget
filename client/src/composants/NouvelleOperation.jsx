import { useState } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Dialogue from "./Dialogue.jsx";
import Segments from "./Segments.jsx";
import { num, libelleMois, moisCle, CATEGORIES } from "../utiles.js";
import { destinationsInternes, depuisValeur, enregistrerMouvement } from "../interne.js";

export const RYTHMES = [
  { cle: "mensuel", nom: "Tous les mois" },
  { cle: "trimestriel", nom: "Tous les 3 mois" },
  { cle: "semestriel", nom: "Tous les 6 mois" },
  { cle: "annuel", nom: "Tous les ans" },
];

const NATURES = [
  { v: "depense", l: "Dépense" },
  { v: "revenu", l: "Revenu" },
  { v: "interne", l: "Interne" },
];

const VIERGE = {
  libelle: "", montant: "", categorie: "Courses", pour: "foyer", type: "depense",
  recurrent: true, periodicite: "mensuel", debut: "", fin: "",
  // Mouvement interne : où va l'argent, dans quel sens, et quel jour.
  destination: "", sortie: true, date: "",
};

const MONTANT = { inputMode: "decimal" };

const aujourdhui = () => {
  const d = new Date();
  return `${moisCle(d)}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Ajouter une dépense, un revenu, ou un mouvement interne.
 *
 * Ouvert depuis la vue d'ensemble comme depuis les opérations : c'est le geste
 * le plus fréquent de l'application, il doit être à un clic partout où l'on
 * regarde son mois.
 *
 * Un mouvement interne — virement vers l'épargne, versement sur un projet,
 * échéance de crédit — n'est pas une dépense : il est enregistré sur le support,
 * le projet ou le crédit concerné, et n'entre pas dans le flux.
 */
export default function NouvelleOperation({ ouvert, onFermer, etat, calc, mois, executer }) {
  const [f, setF] = useState(VIERGE);
  const interne = f.type === "interne";
  // Le mois affiché est celui qu'on est en train de remplir : la date proposée y tombe.
  const dateParDefaut = mois === moisCle() ? aujourdhui() : `${mois}-01`;
  const date = f.date || dateParDefaut;

  const groupes = destinationsInternes(etat, calc.creditsActifs.filter((c) => !c.solde), { entree: interne && !f.sortie });
  const affectation = depuisValeur(f.destination);
  // Une destination qui n'est plus proposée (sens changé, crédit soldé) ne compte plus.
  const destinationValide = affectation && groupes.some((g) => g.options.some((o) => o.v === f.destination));

  const valide = interne
    ? destinationValide && num(f.montant) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date)
    : f.libelle.trim() && num(f.montant) > 0;

  const ajouter = () => {
    if (!valide) return;
    if (interne) {
      executer(() =>
        enregistrerMouvement({ affectation, sortie: f.sortie, montant: num(f.montant), pour: f.pour, date, libelle: f.libelle.trim() }),
      );
    } else {
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
    }
    // On garde nature, catégorie, rythme et destination : on saisit souvent
    // plusieurs lignes de la même sorte d'affilée.
    setF({ ...f, libelle: "", montant: "", date: "" });
    onFermer();
  };

  const note = interne
    ? "Il alimente l'écran concerné, sans compter comme une dépense"
    : f.recurrent ? "Saisie une fois, elle revient d'elle-même" : `Comptée en ${libelleMois(mois).toLowerCase()} uniquement`;

  const pourQui = (
    <Champ classe="plein" libelle={interne ? "Qui fait le mouvement" : "Pour qui"} valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur="100%"
      options={[{ v: "foyer", l: interne ? "Le foyer (compte commun)" : "Le foyer (charge commune)" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
  );

  return (
    <Dialogue
      ouvert={ouvert}
      onFermer={onFermer}
      titre={interne ? "Nouveau mouvement interne" : "Nouvelle opération"}
      note={note}
      pied={
        <>
          <button className="btn fant" onClick={onFermer}>Annuler</button>
          <button className="btn" onClick={ajouter} disabled={!valide}>Ajouter</button>
        </>
      }
    >
      <Segments
        plein libelle="Nature de l'opération" valeur={f.type} onChange={(v) => setF({ ...f, type: v })}
        options={NATURES}
      />

      {interne ? (
        groupes.length === 0 ? (
          <div className="carte-note" style={{ marginTop: 16 }}>
            Aucun support d'épargne, projet ni crédit en cours pour l'instant : créez-en un depuis l'écran
            Épargne, Projets ou Crédits, puis revenez ici.
          </div>
        ) : (
          <>
            <div className="carte-note" style={{ marginTop: 12 }}>
              Virement vers l'épargne, versement sur un projet, échéance de prêt : le budget compte déjà
              le versement prévu ou la mensualité, ce mouvement ne s'y ajoute pas.
            </div>
            <div className="grille-form">
              <div className="plein">
                <Segments
                  plein libelle="Sens du mouvement" valeur={f.sortie ? "sortie" : "entree"}
                  onChange={(v) => setF({ ...f, sortie: v === "sortie" })}
                  options={[{ v: "sortie", l: "Depuis le compte" }, { v: "entree", l: "Vers le compte" }]}
                />
              </div>
              <Champ classe="plein" libelle={f.sortie ? "Vers" : "Depuis le support"} valeur={destinationValide ? f.destination : ""}
                onChange={(v) => setF({ ...f, destination: v })} largeur="100%"
                options={[{ v: "", l: "Choisir…" }, ...groupes]} />
              <Champ libelle="Montant (€)" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur="100%"
                placeholder="0" onEntree={ajouter} attributs={MONTANT} />
              <Champ libelle="Date" valeur={date} onChange={(v) => setF({ ...f, date: v })} largeur="100%" type="date" />
              <Champ classe="plein" libelle="Libellé (facultatif)" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%"
                placeholder="Ex. Virement mensuel" onEntree={ajouter} />
              {pourQui}
            </div>
          </>
        )
      ) : (
        <div className="grille-form">
          <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%"
            placeholder={f.type === "revenu" ? "Ex. Prime, location" : "Ex. Internet, loyer"} onEntree={ajouter} />
          <Champ libelle="Montant (€)" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur="100%"
            placeholder="0" onEntree={ajouter} attributs={MONTANT} />
          <Champ libelle="Catégorie" valeur={f.categorie} onChange={(v) => setF({ ...f, categorie: v })} largeur="100%" options={CATEGORIES} />
          {pourQui}
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
      )}
      {!interne && f.recurrent && f.periodicite !== "mensuel" && (
        <div className="carte-note" style={{ marginTop: 12 }}>
          Le montant est celui d'une échéance : une assurance annuelle de 240 € pèse 240 € sur
          le mois où elle est prélevée, pas 20 € tous les mois.
        </div>
      )}
    </Dialogue>
  );
}
