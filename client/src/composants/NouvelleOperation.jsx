import { useState, useEffect } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Dialogue from "./Dialogue.jsx";
import Segments from "./Segments.jsx";
import { num, libelleMois, moisCle, decalerMois, CATEGORIES, CATEGORIES_REVENU, CATEGORIE_SALAIRE } from "../utiles.js";
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
  // Modification d'une ligne régulière : à partir du mois affiché, ou partout.
  portee: "suite",
};

// Le formulaire rempli d'après une ligne du flux, pour la modifier.
const depuisOperation = (t) => ({
  ...VIERGE,
  type: t.type,
  libelle: t.libelle,
  montant: String(t.montant),
  categorie: t.categorie,
  pour: t.pour,
  recurrent: t.recurrent,
  periodicite: t.periodicite ?? "mensuel",
  debut: t.debut ?? "",
  fin: t.fin ?? "",
  date: !t.recurrent && t.date ? String(t.date).slice(0, 10) : "",
});

const MONTANT = { inputMode: "decimal" };

const aujourdhui = () => {
  const d = new Date();
  return `${moisCle(d)}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Ajouter une dépense, un revenu, ou un mouvement interne — ou modifier une
 * ligne du flux, quand `operation` est fournie.
 *
 * Ouvert depuis la vue d'ensemble comme depuis les opérations : c'est le geste
 * le plus fréquent de l'application, il doit être à un clic partout où l'on
 * regarde son mois.
 *
 * Un mouvement interne — virement vers l'épargne, versement sur un projet,
 * échéance de crédit — n'est pas une dépense : il est enregistré sur le support,
 * le projet ou le crédit concerné, et n'entre pas dans le flux.
 */
export default function NouvelleOperation({ ouvert, onFermer, etat, calc, mois, executer, operation = null }) {
  const [f, setF] = useState(VIERGE);
  const edition = Boolean(operation);

  // À l'ouverture : la ligne à modifier, ou un formulaire neuf après une
  // modification — une saisie ne doit pas repartir d'une ligne existante.
  const [chargee, setChargee] = useState(null);
  useEffect(() => {
    if (!ouvert) return;
    if (operation && chargee !== operation.id) {
      setF(depuisOperation(operation));
      setChargee(operation.id);
    } else if (!operation && chargee) {
      setF(VIERGE);
      setChargee(null);
    }
  }, [ouvert, operation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Une ligne régulière déjà passée par des mois antérieurs : la modifier
  // partout réécrirait ce qu'ils ont été. Par défaut, le changement vaut à
  // partir du mois affiché — l'ancienne ligne s'arrête la veille.
  const scindable = edition && operation.recurrent && !!(operation.debut ? operation.debut < mois : true);
  const scinder = scindable && f.recurrent && f.portee === "suite";
  const interne = f.type === "interne";
  // Le mois affiché est celui qu'on est en train de remplir : la date proposée y tombe.
  const dateParDefaut = mois === moisCle() ? aujourdhui() : `${mois}-01`;
  const date = f.date || dateParDefaut;

  const groupes = destinationsInternes(etat, calc.creditsActifs.filter((c) => !c.solde), { entree: interne && !f.sortie });
  const affectation = depuisValeur(f.destination);
  // Une destination qui n'est plus proposée (sens changé, crédit soldé) ne compte plus.
  const destinationValide = affectation && groupes.some((g) => g.options.some((o) => o.v === f.destination));

  const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const valide = interne
    ? destinationValide && num(f.montant) > 0 && dateValide
    : f.libelle.trim() && num(f.montant) > 0 && (f.recurrent || dateValide);

  // La ligne telle que l'API l'attend. Une ponctuelle tombe dans le mois de sa date.
  const corps = () => ({
    type: f.type,
    libelle: f.libelle.trim(),
    montant: num(f.montant),
    categorie: f.categorie,
    pour: f.pour,
    recurrent: f.recurrent,
    mois: f.recurrent ? null : date.slice(0, 7),
    date: f.recurrent ? null : date,
    periodicite: f.periodicite,
    // Un rythme non mensuel a besoin d'un ancrage ; à défaut, le mois affiché.
    debut: f.recurrent ? (f.debut || (f.periodicite !== "mensuel" ? mois : null)) : null,
    fin: f.recurrent ? (f.fin || null) : null,
  });

  const enregistrer = () => {
    if (!valide) return;
    if (interne) {
      const mouvement = { affectation, sortie: f.sortie, montant: num(f.montant), pour: f.pour, date, libelle: f.libelle.trim() };
      // Une ligne du flux reclassée en mouvement interne quitte le flux.
      executer(async () => {
        await enregistrerMouvement(mouvement);
        if (edition) await api.supprimerTransaction(operation.id);
      });
    } else if (scinder) {
      const ancienne = {
        type: operation.type, libelle: operation.libelle, montant: operation.montant, categorie: operation.categorie,
        pour: operation.pour, recurrent: true, mois: null, periodicite: operation.periodicite ?? "mensuel",
        debut: operation.debut ?? null, fin: decalerMois(mois, -1),
      };
      // Le mois affiché est une échéance de la ligne : la nouvelle en part.
      executer(async () => {
        await api.modifierTransaction(operation.id, ancienne);
        await api.creerTransaction({ ...corps(), debut: mois });
      });
    } else if (edition) {
      executer(() => api.modifierTransaction(operation.id, corps()));
    } else {
      executer(() => api.creerTransaction(corps()));
    }
    // On garde nature, catégorie, rythme et destination : on saisit souvent
    // plusieurs lignes de la même sorte d'affilée.
    if (!edition) setF({ ...f, libelle: "", montant: "", date: "" });
    onFermer();
  };

  const note = interne
    ? "Il alimente l'écran concerné, sans compter comme une dépense"
    : f.recurrent ? "Saisie une fois, elle revient d'elle-même"
    : dateValide ? `Comptée en ${libelleMois(date.slice(0, 7)).toLowerCase()} uniquement` : "Comptée le mois de sa date";

  // Dépense et revenu n'ont pas les mêmes catégories : en changeant de nature,
  // on repart de la catégorie la plus probable de la nouvelle.
  const changerNature = (type) => {
    const categories = type === "revenu" ? CATEGORIES_REVENU : CATEGORIES;
    setF({ ...f, type, categorie: categories.includes(f.categorie) ? f.categorie : type === "revenu" ? CATEGORIE_SALAIRE : "Courses" });
  };
  const salaire = f.type === "revenu" && f.categorie === CATEGORIE_SALAIRE;
  const nomPour = etat.membres.find((m) => m.id === f.pour)?.nom;

  const pourQui = (
    <Champ classe="plein" libelle={interne ? "Qui fait le mouvement" : "Pour qui"} valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur="100%"
      options={[{ v: "foyer", l: interne ? "Le foyer (compte commun)" : "Le foyer (charge commune)" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
  );

  return (
    <Dialogue
      ouvert={ouvert}
      onFermer={onFermer}
      titre={edition ? (interne ? "Reclasser en mouvement interne" : "Modifier l'opération") : interne ? "Nouveau mouvement interne" : "Nouvelle opération"}
      note={note}
      pied={
        <>
          <button className="btn fant" onClick={onFermer}>Annuler</button>
          <button className="btn" onClick={enregistrer} disabled={!valide}>{edition ? "Enregistrer" : "Ajouter"}</button>
        </>
      }
    >
      <Segments
        plein libelle="Nature de l'opération" valeur={f.type} onChange={changerNature}
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
                placeholder="0" onEntree={enregistrer} attributs={MONTANT} />
              <Champ libelle="Date" valeur={date} onChange={(v) => setF({ ...f, date: v })} largeur="100%" type="date" />
              <Champ classe="plein" libelle="Libellé (facultatif)" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%"
                placeholder="Ex. Virement mensuel" onEntree={enregistrer} />
              {pourQui}
            </div>
          </>
        )
      ) : (
        <div className="grille-form">
          <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%"
            placeholder={f.type === "revenu" ? "Ex. Prime, location" : "Ex. Internet, loyer"} onEntree={enregistrer} />
          <Champ libelle="Montant (€)" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur="100%"
            placeholder="0" onEntree={enregistrer} attributs={MONTANT} />
          <Champ libelle="Catégorie" valeur={f.categorie} onChange={(v) => setF({ ...f, categorie: v })} largeur="100%"
            options={f.type === "revenu" ? CATEGORIES_REVENU : CATEGORIES} />
          {pourQui}
          <label className="bascule plein">
            <input type="checkbox" checked={f.recurrent} onChange={(e) => setF({ ...f, recurrent: e.target.checked })} />
            Revient régulièrement
          </label>
          {!f.recurrent && (
            <Champ classe="plein" libelle="Date" valeur={date} onChange={(v) => setF({ ...f, date: v })} largeur="100%" type="date" />
          )}
          {scindable && f.recurrent && (
            <div className="plein">
              <Segments
                plein libelle="Portée de la modification" valeur={f.portee} onChange={(v) => setF({ ...f, portee: v })}
                options={[{ v: "suite", l: `À partir ${libelleMois(mois).toLowerCase().match(/^[aeiou]/) ? "d'" : "de "}${libelleMois(mois).toLowerCase()}` }, { v: "tout", l: "Sur tous les mois" }]}
              />
              <div className="carte-note" style={{ marginTop: 6 }}>
                {f.portee === "suite"
                  ? "Les mois précédents gardent l'ancienne version : un changement de prix ne réécrit pas le passé."
                  : "Pour corriger une erreur de saisie : la ligne change aussi pour tous les mois passés."}
              </div>
            </div>
          )}
          {f.recurrent && (
            <>
              <Champ classe="plein" libelle="Rythme" valeur={f.periodicite} onChange={(v) => setF({ ...f, periodicite: v })} largeur="100%"
                options={RYTHMES.map((r) => ({ v: r.cle, l: r.nom }))} />
              {!scinder && (
                <Champ libelle={f.periodicite === "mensuel" ? "Depuis (facultatif)" : "1er prélèvement"}
                  valeur={f.debut} onChange={(v) => setF({ ...f, debut: v })} largeur="100%" type="month" />
              )}
              <Champ libelle="Jusqu'à (facultatif)" valeur={f.fin} onChange={(v) => setF({ ...f, fin: v })} largeur="100%" type="month" />
            </>
          )}
        </div>
      )}
      {salaire && (
        <div className={`avis ${nomPour ? "ok" : "alerte"}`}>
          {nomPour
            ? `Ce salaire remplacera, pour ${f.recurrent ? "chaque mois où il tombe" : libelleMois(date.slice(0, 7)).toLowerCase()}, le salaire de référence de ${nomPour} saisi dans les réglages.`
            : "Choisissez la personne qui le perçoit : un salaire attribué au foyer ne remplace aucun salaire de référence, il s'y ajoute."}
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
