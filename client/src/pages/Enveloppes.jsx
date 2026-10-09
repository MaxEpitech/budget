// Enveloppes — un plafond mensuel par catégorie de dépense.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import Anneau from "../composants/Anneau.jsx";
import Icone from "../composants/Icone.jsx";
import EtatVide from "../composants/EtatVide.jsx";
import Dialogue from "../composants/Dialogue.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { euro, num, CATEGORIES, couleurBudget, teintePart } from "../utiles.js";

/**
 * Enveloppes mensuelles par catégorie.
 *
 * Le montant seul ne dit rien : c'est l'écart avec ce qui a déjà été dépensé
 * qui intéresse. Chaque enveloppe est donc montrée pleine ou vide, et la couleur
 * change avant le dépassement — prévenir après coup n'aurait servi à rien.
 */
// Le seuil et les couleurs vivent dans utiles.js : les opérations s'en servent
// aussi, et deux définitions finiraient par diverger.

export default function Enveloppes({ budgets, executer }) {
  const [f, setF] = useState({ categorie: "", montant: "" });
  const [ajout, setAjout] = useState(false);
  const [survolee, setSurvolee] = useState(null);

  // On ne propose que les catégories sans enveloppe : deux budgets concurrents
  // sur la même n'auraient aucun sens.
  const libres = CATEGORIES.filter((c) => !budgets.some((b) => b.categorie === c));

  const definir = () => {
    const categorie = f.categorie || libres[0];
    if (!categorie || num(f.montant) <= 0) return;
    executer(() => api.definirBudget(categorie, num(f.montant)));
    setF({ categorie: "", montant: "" });
    setAjout(false);
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

  const boutonAjout = libres.length > 0 && (
    <button className="btn" onClick={() => setAjout(true)}>
      <Icone nom="plus" /> Nouvelle enveloppe
    </button>
  );

  return (
    <>
      <EnTetePage
        titre="Enveloppes"
        description={
          budgets.length === 0
            ? "Un plafond mensuel pour chaque catégorie de dépense qui varie"
            : depassements.length === 0
              ? "Toutes les enveloppes tiennent ce mois-ci"
              : `${depassements.length} enveloppe${depassements.length > 1 ? "s" : ""} dépassée${depassements.length > 1 ? "s" : ""} ce mois-ci`
        }
        actions={boutonAjout}
      />

      {budgets.length === 0 ? (
        <Carte>
          <EtatVide
            icone="enveloppes"
            titre="Aucune enveloppe"
            texte="Utile pour les postes qui varient — courses, loisirs, transport — moins pour un loyer, qui ne bouge pas."
            action={boutonAjout}
          />
        </Carte>
      ) : (
        <>
          <Carte titre="Où part l'argent" note={`${euro(consomme)} dépensés sur ${euro(enveloppes)} prévus`}>
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
          </Carte>

          <div className="grille">
            {budgets.map((b) => {
              const part = b.montant > 0 ? b.consomme / b.montant : 0;
              const restant = b.montant - b.consomme;
              return (
                <section className="carte enveloppe" key={b.id} style={{ "--teinte": couleurBudget(part) }}>
                  <div className="corps">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                      <div className="ligne-lib">{b.categorie}</div>
                      <button className="suppr" onClick={() => executer(() => api.supprimerBudget(b.id))}
                        aria-label={`Supprimer l'enveloppe ${b.categorie}`}>
                        <Icone nom="corbeille" taille={16} />
                      </button>
                    </div>
                    <div className="chiffre" style={{ fontSize: 22, fontWeight: 650, marginTop: 2, letterSpacing: "-0.02em" }}>
                      {euro(b.consomme)}{" "}
                      <span style={{ color: "var(--doux)", fontWeight: 400, fontSize: 14 }}>/ {euro(b.montant)}</span>
                    </div>
                    <Jauge pct={part * 100} couleur={couleurBudget(part)} />
                    <div className="enveloppe-pied">
                      <div className="carte-note" style={{ color: restant < 0 ? "var(--brique)" : undefined }}>
                        {restant >= 0 ? `Il reste ${euro(restant)} ce mois-ci.` : `Dépassé de ${euro(-restant)}.`}
                      </div>
                      <Champ
                        libelle="Plafond /mois" valeur={String(b.montant)} largeur={110} attributs={{ inputMode: "decimal" }}
                        onChange={(v) => num(v) > 0 && executer(() => api.definirBudget(b.categorie, num(v)))}
                      />
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}

      <Dialogue
        ouvert={ajout}
        onFermer={() => setAjout(false)}
        titre="Nouvelle enveloppe"
        note="Le plafond est mensuel ; ce qui est dépensé se compte tout seul, d'après les opérations"
        pied={
          <>
            <button className="btn fant" onClick={() => setAjout(false)}>Annuler</button>
            <button className="btn" onClick={definir} disabled={num(f.montant) <= 0}>Créer l'enveloppe</button>
          </>
        }
      >
        <div className="grille-form">
          <Champ
            libelle="Catégorie" valeur={f.categorie || libres[0] || ""} largeur="100%"
            onChange={(v) => setF({ ...f, categorie: v })} options={libres}
          />
          <Champ
            libelle="Plafond /mois (€)" valeur={f.montant} largeur="100%" placeholder="0"
            onChange={(v) => setF({ ...f, montant: v })} onEntree={definir} attributs={{ inputMode: "decimal" }}
          />
        </div>
      </Dialogue>
    </>
  );
}
