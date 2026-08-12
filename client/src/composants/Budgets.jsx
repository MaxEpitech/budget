import { useState } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import Jauge from "./Jauge.jsx";
import { euro, num, CATEGORIES } from "../utiles.js";

/**
 * Enveloppes mensuelles par catégorie.
 *
 * Le montant seul ne dit rien : c'est l'écart avec ce qui a déjà été dépensé
 * qui intéresse. Chaque enveloppe est donc montrée pleine ou vide, et la couleur
 * change avant le dépassement — prévenir après coup n'aurait servi à rien.
 */
const SEUIL_ALERTE = 0.85;

function couleurDe(part) {
  if (part > 1) return "var(--brique)";
  if (part >= SEUIL_ALERTE) return "var(--ocre)";
  return "var(--caisse)";
}

export default function Budgets({ budgets, executer }) {
  const [f, setF] = useState({ categorie: "", montant: "" });

  // On ne propose que les catégories sans enveloppe : deux budgets concurrents
  // sur la même n'auraient aucun sens.
  const libres = CATEGORIES.filter((c) => !budgets.some((b) => b.categorie === c));

  const definir = () => {
    const categorie = f.categorie || libres[0];
    if (!categorie || num(f.montant) <= 0) return;
    executer(() => api.definirBudget(categorie, num(f.montant)));
    setF({ categorie: "", montant: "" });
  };

  const depassements = budgets.filter((b) => b.consomme > b.montant);

  return (
    <Carte
      titre="Budgets par catégorie"
      note={
        budgets.length === 0
          ? "Fixez une enveloppe mensuelle pour suivre vos dépenses variables"
          : depassements.length === 0
            ? "Toutes les enveloppes tiennent ce mois-ci"
            : `${depassements.length} enveloppe${depassements.length > 1 ? "s" : ""} dépassée${depassements.length > 1 ? "s" : ""}`
      }
    >
      {budgets.map((b) => {
        const part = b.montant > 0 ? b.consomme / b.montant : 0;
        const restant = b.montant - b.consomme;
        return (
          <div className="corps" key={b.id} style={{ borderBottom: "1px solid #EDF1F3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div className="ligne-lib">{b.categorie}</div>
              <div className="chiffre" style={{ fontWeight: 600 }}>
                {euro(b.consomme)}{" "}
                <span style={{ color: "var(--doux)", fontWeight: 400, fontSize: 14 }}>/ {euro(b.montant)}</span>
              </div>
            </div>
            <Jauge pct={part * 100} couleur={couleurDe(part)} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 7, flexWrap: "wrap" }}>
              <div className="carte-note">
                {restant >= 0
                  ? `Il reste ${euro(restant)} ce mois-ci.`
                  : `Dépassé de ${euro(-restant)}.`}
              </div>
              <div className="forme">
                <Champ
                  libelle="Enveloppe /mois" valeur={String(b.montant)} largeur={110}
                  onChange={(v) => num(v) > 0 && executer(() => api.definirBudget(b.categorie, num(v)))}
                />
                <button className="suppr" style={{ opacity: 1 }} onClick={() => executer(() => api.supprimerBudget(b.id))}
                  aria-label={`Supprimer l'enveloppe ${b.categorie}`}>×</button>
              </div>
            </div>
          </div>
        );
      })}

      {budgets.length === 0 && (
        <div className="vide">
          Aucune enveloppe. Utile pour les postes qui varient — courses, loisirs, transport —
          moins pour un loyer, qui ne bouge pas.
        </div>
      )}

      {libres.length > 0 && (
        <div className="corps">
          <div className="forme">
            <Champ
              libelle="Catégorie" valeur={f.categorie || libres[0]} largeur={150}
              onChange={(v) => setF({ ...f, categorie: v })} options={libres}
            />
            <Champ
              libelle="Enveloppe /mois" valeur={f.montant} largeur={120} placeholder="0"
              onChange={(v) => setF({ ...f, montant: v })} onEntree={definir}
            />
            <button className="btn" onClick={definir}>Fixer</button>
          </div>
        </div>
      )}
    </Carte>
  );
}
