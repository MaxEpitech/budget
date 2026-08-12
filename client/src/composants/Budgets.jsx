import { useState } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import Jauge from "./Jauge.jsx";
import Anneau from "./Anneau.jsx";
import { euro, num, CATEGORIES, couleurBudget, teintePart } from "../utiles.js";

/**
 * Enveloppes mensuelles par catégorie.
 *
 * Le montant seul ne dit rien : c'est l'écart avec ce qui a déjà été dépensé
 * qui intéresse. Chaque enveloppe est donc montrée pleine ou vide, et la couleur
 * change avant le dépassement — prévenir après coup n'aurait servi à rien.
 */
// Le seuil et les couleurs vivent dans utiles.js : les dépenses de l'onglet
// Flux s'en servent aussi, et deux définitions finiraient par diverger.

export default function Budgets({ budgets, executer }) {
  const [f, setF] = useState({ categorie: "", montant: "" });
  const [survolee, setSurvolee] = useState(null);

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

  // L'anneau dit où va l'argent, les barres en dessous disent si ça tient :
  // un camembert ne sait pas montrer un dépassement, et une barre ne sait pas
  // comparer deux postes entre eux. Les deux lectures sont complémentaires.
  const consomme = budgets.reduce((s, b) => s + b.consomme, 0);
  const enveloppes = budgets.reduce((s, b) => s + b.montant, 0);
  const disponible = Math.max(0, enveloppes - consomme);

  const parts = budgets.map((b, i) => ({
    cle: b.categorie,
    libelle: `${b.categorie} : ${euro(b.consomme)}`,
    nom: b.categorie,
    montant: Math.max(0, b.consomme),
    enveloppe: b.montant,
    couleur: teintePart(i),
  }));
  // Ce qui reste dans les enveloppes ferme le tour : sans cette part, un mois
  // à peine entamé donnerait un anneau plein, donc rassurant à tort.
  const partsAnneau = disponible > 0
    ? [...parts, { cle: "__reste", nom: "Encore disponible", libelle: `Encore disponible : ${euro(disponible)}`, montant: disponible, couleur: "var(--bord)" }]
    : parts;

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
      {budgets.length > 0 && (
        <div className="corps anneau">
          <Anneau
            parts={partsAnneau}
            actif={survolee}
            onSurvol={setSurvolee}
            centreHaut={euro(consomme)}
            centreBas={`sur ${euro(enveloppes)}`}
            titre={`Répartition du consommé : ${parts.map((p) => p.libelle).join(", ")}`}
          />
          <div className="anneau-legende">
            {partsAnneau.map((p) => (
              <button
                key={p.cle}
                className="anneau-ligne"
                data-actif={survolee === p.cle ? "1" : "0"}
                onMouseEnter={() => setSurvolee(p.cle)}
                onMouseLeave={() => setSurvolee(null)}
                onFocus={() => setSurvolee(p.cle)}
                onBlur={() => setSurvolee(null)}
              >
                <span className="pastille" style={{ background: p.couleur }} />
                <span className="anneau-nom">{p.nom}</span>
                <span className="anneau-val chiffre">{euro(p.montant)}</span>
                {/* « sur 500 € » et non « 25 % » : dans la légende d'un
                    camembert, un pourcentage se lit comme une part du tour,
                    alors qu'il s'agirait ici du remplissage de l'enveloppe. */}
                <span className="anneau-part chiffre">
                  {p.enveloppe > 0 ? `sur ${euro(p.enveloppe)}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {budgets.map((b) => {
        const part = b.montant > 0 ? b.consomme / b.montant : 0;
        const restant = b.montant - b.consomme;
        return (
          <div className="corps" key={b.id} style={{ borderBottom: "1px solid var(--filet-fin)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div className="ligne-lib">{b.categorie}</div>
              <div className="chiffre" style={{ fontWeight: 600 }}>
                {euro(b.consomme)}{" "}
                <span style={{ color: "var(--doux)", fontWeight: 400, fontSize: 14 }}>/ {euro(b.montant)}</span>
              </div>
            </div>
            <Jauge pct={part * 100} couleur={couleurBudget(part)} />
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
