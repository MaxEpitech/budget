// Épargne — logique du prototype ; seules les écritures passent par l'API.
import { useState, useMemo } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";
import Segments from "../composants/Segments.jsx";
import EtatVide from "../composants/EtatVide.jsx";
import Dialogue from "../composants/Dialogue.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { euro, euroPrecis, num, libelleMois, libelleDate, moisCle, decalerMois, verseCeMois, teinteMembre } from "../utiles.js";
import { projeterPlafonne, verseAvecPlafond, moisAvantPlafond } from "../finance.js";

// Un plafond vide ou nul signifie « pas de plafond ».
const plafondSaisi = (v) => (num(v) > 0 ? num(v) : null);

export default function Epargne({ etat, mois, executer, modifier, supprimer }) {
  const [horizon, setHorizon] = useState(10);
  const [ouvert, setOuvert] = useState(null);
  const [ajout, setAjout] = useState(false);
  const [f, setF] = useState({ libelle: "", valeur: "", versement: "", rendement: "", plafond: "", pour: "foyer" });
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");

  const ajouter = () => {
    if (!f.libelle.trim()) return;
    executer(() =>
      api.creerPlacement({
        libelle: f.libelle.trim(),
        valeur: num(f.valeur),
        versement: num(f.versement),
        rendement: num(f.rendement),
        plafond: plafondSaisi(f.plafond),
        pour: f.pour,
      })
    );
    setF({ libelle: "", valeur: "", versement: "", rendement: "", plafond: "", pour: "foyer" });
    setAjout(false);
  };

  const valeurTotale = etat.placements.reduce((s, p) => s + p.valeur, 0);
  const versementTotal = etat.placements.reduce((s, p) => s + p.versement, 0);

  const courbe = useMemo(() => {
    const pts = [];
    for (let annee = 0; annee <= horizon; annee++) {
      const m = annee * 12;
      const valeur = etat.placements.reduce((s, p) => s + projeterPlafonne(p.valeur, p.versement, p.rendement, m, p.plafond), 0);
      // Le cumul versé s'arrête lui aussi aux plafonds atteints.
      const verse = etat.placements.reduce((s, p) => s + verseAvecPlafond(p.valeur, p.versement, p.rendement, m, p.plafond), 0);
      pts.push({ annee, valeur, verse });
    }
    return pts;
  }, [etat.placements, horizon]);

  const final = courbe[courbe.length - 1];

  const boutonAjout = (
    <button className="btn" onClick={() => setAjout(true)}>
      <Icone nom="plus" /> Nouveau support
    </button>
  );

  return (
    <>
      <EnTetePage
        titre="Épargne"
        description={
          etat.placements.length
            ? `${euro(valeurTotale)} placés · ${euro(versementTotal)} versés chaque mois`
            : "Livrets, assurance vie, PEA : ce que vous avez, et ce que ça deviendra"
        }
        actions={boutonAjout}
      />

      {etat.placements.length === 0 ? (
        <Carte>
          <EtatVide
            icone="epargne"
            titre="Aucun support d'épargne"
            texte="Ajoutez un livret ou un placement avec sa valeur, votre versement mensuel et son rendement : l'application projette ce qu'il vaudra, plafond compris."
            action={boutonAjout}
          />
        </Carte>
      ) : (
      <>
      <Carte
        titre="Projection"
        note={`Épargne du foyer sur ${horizon} ans`}
        action={
          <Segments
            libelle="Horizon de la projection" valeur={horizon} onChange={setHorizon}
            options={[5, 10, 20].map((h) => ({ v: h, l: `${h} ans` }))}
          />
        }
      >
        <div className="corps">
          <Courbe points={courbe} />
          <div className="duo" style={{ marginTop: 14 }}>
            <div>
              <div className="stat-lib">Valeur projetée</div>
              <div className="stat-val chiffre" style={{ color: "var(--indigo)" }}>{euro(final.valeur)}</div>
            </div>
            <div>
              <div className="stat-lib">Dont intérêts</div>
              <div className="stat-val chiffre" style={{ color: "var(--caisse)" }}>{euro(final.valeur - final.verse)}</div>
            </div>
          </div>
          <div className="carte-note" style={{ marginTop: 8 }}>
            Hypothèse : rendement constant, versements maintenus. Une projection n'est pas une garantie.
          </div>
        </div>
      </Carte>

      <Carte titre="Supports" note="Valeur, versement, rendement et plafond se modifient directement">
        {etat.placements.map((p) => {
          const atteint = p.plafond != null && p.valeur >= p.plafond;
          // Découvrir le plafond une fois dedans est trop tard : les versements
          // versés au-delà sont refusés par la banque. On annonce la date.
          const echeance = atteint ? null : moisAvantPlafond(p.valeur, p.versement, p.rendement, p.plafond);
          // Le budget annonce ce versement tous les mois ; encore faut-il qu'il
          // ait eu lieu.
          const aVerse = verseCeMois(p.mouvements, mois);
          const manquant = p.versement > 0 && !aVerse && !atteint;
          // Sur un mois passé, le constat reste vrai mais n'appelle plus
          // d'action : on ne verse qu'aujourd'hui.
          const aRelancer = manquant && mois === moisCle();
          return (
            <div key={p.id} className="support">
              <div className="corps">
                <div className="support-tete">
                  <div style={{ minWidth: 0 }}>
                    <div className="ligne-lib">
                      {p.libelle}{" "}
                      <span className="etiq perso" style={{ "--teinte": teinteMembre(etat.membres, p.pour) }}>{nomDe(p.pour)}</span>{" "}
                      {atteint && <span className="etiq perso" style={{ "--teinte": "var(--caisse)" }}>Plafond atteint</span>}
                    </div>
                    <div className="ligne-meta">
                      {p.rendement} % par an · {euro(projeterPlafonne(p.valeur, p.versement, p.rendement, horizon * 12, p.plafond))} dans {horizon} ans
                      {p.plafond != null && ` · plafond ${euro(p.plafond)}`}
                    </div>
                  </div>
                  <div className="support-valeur chiffre">{euro(p.valeur)}</div>
                  <button className="suppr" onClick={() => supprimer("placements", p.id, p.libelle)} aria-label={`Supprimer ${p.libelle}`}><Icone nom="corbeille" taille={16} /></button>
                </div>
                {echeance != null && (
                  <div className={`avis ${echeance <= 12 ? "alerte" : "ok"}`}>
                    Plafond atteint en {libelleMois(decalerMois(moisCle(), echeance)).toLowerCase()}
                    {echeance <= 12 ? " — moins d'un an." : `, dans ${Math.round(echeance / 12)} ans.`}
                  </div>
                )}
                {manquant && (
                  <div className="avis alerte">
                    Aucun versement en {libelleMois(mois).toLowerCase()}, alors que le budget en compte{" "}
                    {euro(p.versement)}.
                  </div>
                )}
                <div className="grille-champs">
                  <Champ libelle="Valeur (€)" valeur={String(p.valeur)} onChange={(v) => modifier("placements", p.id, { valeur: num(v) })} largeur="100%" attributs={{ inputMode: "decimal" }} />
                  <Champ libelle="Versement /mois" valeur={String(p.versement)} onChange={(v) => modifier("placements", p.id, { versement: num(v) })} largeur="100%" attributs={{ inputMode: "decimal" }} />
                  <Champ libelle="Rendement %" valeur={String(p.rendement)} onChange={(v) => modifier("placements", p.id, { rendement: num(v) })} largeur="100%" attributs={{ inputMode: "decimal" }} />
                  <Champ libelle="Plafond (€)" valeur={p.plafond == null ? "" : String(p.plafond)} onChange={(v) => modifier("placements", p.id, { plafond: plafondSaisi(v) })} largeur="100%" placeholder="aucun" attributs={{ inputMode: "decimal" }} />
                  <Champ libelle="Pour qui" valeur={p.pour} onChange={(v) => modifier("placements", p.id, { pour: v })} largeur="100%"
                    options={[{ v: "foyer", l: "Foyer" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
                  {p.versement > 0 && !atteint && (
                    <button className={`btn mini ${aRelancer ? "" : "fant"}`}
                      onClick={() => executer(() => api.mouvementer(p.id, "versement", p.versement))}>
                      Verser {euro(p.versement)}
                    </button>
                  )}
                  <button className="btn fant mini" onClick={() => setOuvert(ouvert === p.id ? null : p.id)}>
                    {ouvert === p.id ? "Masquer" : `Mouvements (${p.mouvements?.length ?? 0})`}
                  </button>
                </div>
              </div>

              {ouvert === p.id && (
                <Mouvements placement={p} membres={etat.membres} executer={executer} />
              )}
            </div>
          );
        })}
      </Carte>

      </>
      )}

      <Dialogue
        ouvert={ajout}
        onFermer={() => setAjout(false)}
        titre="Nouveau support d'épargne"
        note="Livret, assurance vie, PEA… Le plafond est facultatif"
        pied={
          <>
            <button className="btn fant" onClick={() => setAjout(false)}>Annuler</button>
            <button className="btn" onClick={ajouter} disabled={!f.libelle.trim()}>Ajouter le support</button>
          </>
        }
      >
        <div className="grille-form">
          <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%" placeholder="Ex. Assurance vie" onEntree={ajouter} />
          <Champ libelle="Valeur actuelle (€)" valeur={f.valeur} onChange={(v) => setF({ ...f, valeur: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Versement /mois (€)" valeur={f.versement} onChange={(v) => setF({ ...f, versement: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Rendement (%/an)" valeur={f.rendement} onChange={(v) => setF({ ...f, rendement: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Plafond (€)" valeur={f.plafond} onChange={(v) => setF({ ...f, plafond: v })} largeur="100%" placeholder="aucun" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ classe="plein" libelle="Pour qui" valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur="100%"
            options={[{ v: "foyer", l: "Le foyer (épargne commune)" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
        </div>
      </Dialogue>
    </>
  );
}

function Courbe({ points }) {
  const L = 620, H = 190, mg = { g: 8, d: 8, h: 12, b: 22 };
  const max = Math.max(...points.map((p) => p.valeur), 1);
  const x = (i) => mg.g + (i / Math.max(1, points.length - 1)) * (L - mg.g - mg.d);
  const y = (v) => mg.h + (1 - v / max) * (H - mg.h - mg.b);

  const traceur = (cle) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[cle]).toFixed(1)}`).join(" ");
  const aire = `${traceur("valeur")} L ${x(points.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`;

  return (
    <svg viewBox={`0 0 ${L} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Projection de l'épargne">
      <path d={aire} fill="var(--indigo)" opacity="0.09" />
      <path d={traceur("verse")} fill="none" stroke="var(--doux)" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={traceur("valeur")} fill="none" stroke="var(--indigo)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) =>
        i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? (
          <text key={i} x={x(i)} y={H - 6} fontSize="10" fill="var(--doux)" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {p.annee === 0 ? "auj." : `+${p.annee} an${p.annee > 1 ? "s" : ""}`}
          </text>
        ) : null
      )}
    </svg>
  );
}

/**
 * Historique d'un support : ce qui a été versé, ce qui a été retiré.
 *
 * Les intérêts n'y figurent pas — ils ne sont l'acte de personne, et se lisent
 * dans l'écart entre la valeur du support et le cumul des mouvements. Cet écart
 * n'est pas pour autant un gain : il contient aussi ce que le support valait
 * avant qu'on commence à le suivre. Le texte le dit plutôt que de laisser croire
 * à une performance.
 */
function Mouvements({ placement, membres, executer }) {
  const [f, setF] = useState({ montant: "", type: "versement", pour: "foyer" });
  const mouvements = placement.mouvements ?? [];

  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : membres.find((m) => m.id === cle)?.nom || "—");
  const verse = mouvements.reduce((s, m) => s + (m.type === "retrait" ? -m.montant : m.montant), 0);

  const enregistrer = () => {
    if (num(f.montant) <= 0) return;
    executer(() => api.mouvementer(placement.id, f.type, num(f.montant), f.pour));
    setF({ ...f, montant: "" });
  };

  return (
    <div className="corps" style={{ background: "var(--survol)" }}>
      <div className="forme">
        <Champ libelle="Montant" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur={110} placeholder="0" onEntree={enregistrer} />
        <Champ libelle="Sens" valeur={f.type} onChange={(v) => setF({ ...f, type: v })} largeur={130}
          options={[{ v: "versement", l: "Versement" }, { v: "retrait", l: "Retrait" }]} />
        <Champ libelle="Qui" valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur={120}
          options={[{ v: "foyer", l: "Foyer" }, ...membres.map((m) => ({ v: m.id, l: m.nom }))]} />
        <button className="btn mini" onClick={enregistrer}>Enregistrer</button>
      </div>

      {mouvements.length === 0 && (
        <div className="vide">Aucun mouvement enregistré sur ce support.</div>
      )}

      {mouvements.map((m) => (
        <div key={m.id} className="ligne" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <span className="ligne-meta">
            <span className="etiq perso" style={{ "--teinte": teinteMembre(membres, m.pour) }}>{nomDe(m.pour)}</span>
            {" · "}{libelleDate(m.date)}
            {m.libelle && <> · {m.libelle}</>}
          </span>
          <span className="pousse chiffre" style={{ fontWeight: 600, color: m.type === "retrait" ? "var(--brique)" : "var(--caisse)" }}>
            {m.type === "retrait" ? "−" : "+"}{euroPrecis(m.montant)}
          </span>
          <span className="ligne-meta" style={{ minWidth: 92, textAlign: "right" }}>
            solde {euro(m.valeurApres)}
          </span>
          <button className="suppr" onClick={() => executer(() => api.supprimerMouvement(placement.id, m.id))}
            aria-label="Supprimer ce mouvement"><Icone nom="corbeille" taille={16} /></button>
        </div>
      ))}

      {mouvements.length > 0 && (
        <div className="carte-note" style={{ marginTop: 10 }}>
          {euro(verse)} de mouvements enregistrés. La valeur du support, {euro(placement.valeur)},
          comprend aussi ce qui s'y trouvait avant le premier mouvement et les intérêts versés
          depuis. Supprimer un mouvement retire son effet de cette valeur.
        </div>
      )}
    </div>
  );
}
