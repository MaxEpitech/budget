// Vue d'ensemble — le mois en un coup d'œil, et ce qui demande attention.
//
// Écran d'arrivée : on y lit ce qui reste, où part l'argent, et ce qui cloche.
// Chaque chiffre mène à l'écran qui le détaille ; rien ne s'y modifie, sauf
// l'ajout d'une opération, le geste le plus courant.
import { useState } from "react";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import Tuile from "../composants/Tuile.jsx";
import Icone from "../composants/Icone.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import NouvelleOperation from "../composants/NouvelleOperation.jsx";
import { moisAvantPlafond } from "../finance.js";
import {
  euro, libelleMois, decalerMois, moisCle, ecartMois, verseCeMois, teinteMembre, POSTES, SEUIL_BUDGET,
} from "../utiles.js";

// L'écran qui détaille chaque part de la bande.
const CIBLES = { depenses: "operations", credits: "credits", projets: "projets", placements: "epargne", reste: "operations" };

const TONS = { alerte: 0, attention: 1, info: 2 };

/**
 * Ce qui mérite d'être vu ce mois-ci, du plus grave au plus anodin. Chaque
 * constat reprend la règle de l'écran qui le détaille : l'accueil ne doit
 * jamais signaler ce que l'écran concerné ne montrerait pas.
 */
function constats(etat, calc, mois) {
  const liste = [];
  if (calc.reste < 0) {
    liste.push({ ton: "alerte", texte: `Le mois est déficitaire de ${euro(-calc.reste)}.`, cible: "operations" });
  }
  for (const b of etat.budgets ?? []) {
    const part = b.montant > 0 ? b.consomme / b.montant : 0;
    if (part > 1) liste.push({ ton: "alerte", texte: `Enveloppe ${b.categorie} dépassée de ${euro(b.consomme - b.montant)}.`, cible: "enveloppes" });
    else if (part >= SEUIL_BUDGET) liste.push({ ton: "attention", texte: `Enveloppe ${b.categorie} consommée à ${Math.round(part * 100)} %.`, cible: "enveloppes" });
  }
  if (calc.revenus > 0 && calc.credits / calc.revenus > 0.35) {
    liste.push({
      ton: "attention",
      texte: `Les crédits pèsent ${Math.round((calc.credits / calc.revenus) * 100)} % des revenus, au-delà du seuil de 35 %.`,
      cible: "credits",
    });
  }
  // Une échéance attendue mais pas vue sur le compte — seulement pour les crédits
  // dont on suit les prélèvements : sans aucun paiement saisi, rien n'est attendu.
  for (const c of calc.creditsActifs) {
    if (c.solde || ecartMois(c.debut, mois) < 0 || !(c.paiements ?? []).length) continue;
    if (!c.paiements.some((p) => moisCle(new Date(p.date)) === mois)) {
      liste.push({ ton: "info", texte: `Crédit « ${c.libelle} » : aucune échéance vue en ${libelleMois(mois).toLowerCase()}.`, cible: "credits" });
    }
  }
  for (const p of etat.projets) {
    const restant = Math.max(0, p.objectif - p.epargne);
    if (restant <= 0) continue;
    const requis = restant / Math.max(1, ecartMois(mois, p.echeance));
    if (p.versement > 0 && !verseCeMois(p.versements, mois)) {
      liste.push({ ton: "info", texte: `Projet « ${p.libelle} » : rien versé en ${libelleMois(mois).toLowerCase()}.`, cible: "projets" });
    }
    if (p.versement < requis - 0.5) {
      liste.push({ ton: "attention", texte: `Projet « ${p.libelle} » : il faudrait ${euro(requis)} par mois pour tenir l'échéance.`, cible: "projets" });
    }
  }
  for (const p of etat.placements) {
    const atteint = p.plafond != null && p.valeur >= p.plafond;
    if (p.versement > 0 && !atteint && !verseCeMois(p.mouvements, mois)) {
      liste.push({ ton: "info", texte: `${p.libelle} : aucun versement en ${libelleMois(mois).toLowerCase()}.`, cible: "epargne" });
    }
    const echeance = atteint ? null : moisAvantPlafond(p.valeur, p.versement, p.rendement, p.plafond);
    if (echeance != null && echeance <= 12) {
      liste.push({
        ton: "attention",
        texte: `${p.libelle} atteindra son plafond en ${libelleMois(decalerMois(moisCle(), echeance)).toLowerCase()}.`,
        cible: "epargne",
      });
    }
  }
  return liste.sort((a, b) => TONS[a.ton] - TONS[b.ton]);
}

const ICONES_TON = { alerte: "alerte", attention: "alerte", info: "info" };

export default function Accueil({ etat, calc, mois, executer, naviguer }) {
  const [survol, setSurvol] = useState(null);
  const [ajout, setAjout] = useState(false);

  const pct = (v) => (calc.revenus ? Math.round((v / calc.revenus) * 100) : 0);
  const aSurveiller = constats(etat, calc, mois);
  const vide = etat.membres.every((m) => !m.revenu) && calc.actifs.length === 0;

  return (
    <>
      <EnTetePage
        titre="Vue d'ensemble"
        description={`Le budget du foyer en ${libelleMois(mois).toLowerCase()}`}
        actions={
          <button className="btn" onClick={() => setAjout(true)}>
            <Icone nom="plus" /> Nouvelle opération
          </button>
        }
      />

      {/* ── Le chiffre qu'on vient chercher, et d'où il vient ── */}
      <section className="carte resume">
        <div className="resume-haut">
          <div>
            <div className="resume-lib">Reste à vivre</div>
            <div className={`resume-val chiffre${calc.reste < 0 ? " neg" : ""}`}>{euro(calc.reste)}</div>
            <div className="resume-note">
              sur <strong className="chiffre">{euro(calc.revenus)}</strong> de revenus
              {calc.revenus > 0 && <> · {pct(Math.max(0, calc.reste))} % restent disponibles</>}
            </div>
          </div>
          {vide && (
            <button className="btn fant" onClick={() => naviguer("foyer")}>
              <Icone nom="foyer" /> Renseigner les revenus
            </button>
          )}
        </div>

        <div className="bande" role="img" aria-label="Répartition des revenus du mois">
          {Object.entries(POSTES).map(([cle, poste]) => {
            const p = calc.parts[cle];
            if (p.pct <= 0) return null;
            return (
              <button
                key={cle}
                className="seg"
                data-actif={survol === cle ? "1" : "0"}
                style={{ width: `${p.pct}%`, background: `var(${poste.var})` }}
                onClick={() => naviguer(CIBLES[cle])}
                onMouseEnter={() => setSurvol(cle)}
                onMouseLeave={() => setSurvol(null)}
                aria-label={`${poste.nom} : ${euro(p.montant)}`}
                title={`${poste.nom} : ${euro(p.montant)} (${Math.round(p.pct)} %)`}
              />
            );
          })}
        </div>
        <div className="legende">
          {Object.entries(POSTES).map(([cle, poste]) => (
            <button
              key={cle}
              className="puce"
              data-actif={survol === cle ? "1" : "0"}
              onClick={() => naviguer(CIBLES[cle])}
              onMouseEnter={() => setSurvol(cle)}
              onMouseLeave={() => setSurvol(null)}
            >
              <span className="pastille" style={{ background: `var(${poste.var})` }} />
              <span className="puce-lib">{poste.nom}</span>
              <span className="puce-val chiffre">{euro(calc.parts[cle].montant)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Les postes, un par un ── */}
      <div className="tuiles">
        <Tuile
          libelle="Dépenses" icone="operations" teinte="var(--depenses)" valeur={euro(calc.depenses)}
          note={`${pct(calc.depenses)} % des revenus`} onClick={() => naviguer("operations")}
        />
        <Tuile
          libelle="Crédits" icone="credits" teinte="var(--credits)" valeur={euro(calc.credits)}
          note={calc.creditsActifs.some((c) => !c.solde) ? `${pct(calc.credits)} % des revenus` : "Aucun crédit en cours"}
          onClick={() => naviguer("credits")}
        />
        <Tuile
          libelle="Projets" icone="projets" teinte="var(--projets)" valeur={euro(calc.projets)}
          note={etat.projets.length ? `${etat.projets.length} enveloppe${etat.projets.length > 1 ? "s" : ""} alimentée${etat.projets.length > 1 ? "s" : ""}` : "Aucun projet"}
          onClick={() => naviguer("projets")}
        />
        <Tuile
          libelle="Épargne" icone="epargne" teinte="var(--epargne)" valeur={euro(calc.placements)}
          note={etat.placements.length ? `versés sur ${etat.placements.length} support${etat.placements.length > 1 ? "s" : ""}` : "Aucun support"}
          onClick={() => naviguer("epargne")}
        />
      </div>

      <div className="duo">
        <Carte titre="À surveiller" note={aSurveiller.length ? `${aSurveiller.length} point${aSurveiller.length > 1 ? "s" : ""} ce mois-ci` : undefined}>
          {aSurveiller.length === 0 ? (
            <div className="constat-ok">
              <span className="etat-vide-icone ok"><Icone nom="ok" taille={22} /></span>
              <div>
                <div className="ligne-lib">Rien à signaler</div>
                <div className="ligne-meta">Enveloppes, projets et épargne suivent leur cours.</div>
              </div>
            </div>
          ) : (
            <ul className="constats">
              {aSurveiller.slice(0, 7).map((c, i) => (
                <li key={i}>
                  <button className="constat" data-ton={c.ton} onClick={() => naviguer(c.cible)}>
                    <span className="constat-icone"><Icone nom={ICONES_TON[c.ton]} taille={16} /></span>
                    <span className="constat-texte">{c.texte}</span>
                    <Icone nom="droite" taille={16} />
                  </button>
                </li>
              ))}
              {aSurveiller.length > 7 && (
                <li className="ligne-meta" style={{ padding: "8px 20px 12px" }}>Et {aSurveiller.length - 7} autre{aSurveiller.length - 7 > 1 ? "s" : ""}.</li>
              )}
            </ul>
          )}
        </Carte>

        <Carte
          titre="Qui paie quoi"
          note={etat.repartition === "prorata" ? "Charges communes au prorata des revenus" : "Charges communes partagées à parts égales"}
          action={<button className="btn fant mini" onClick={() => naviguer("foyer")}>Modifier</button>}
        >
          {calc.parMembre.length === 0 && (
            <div className="vide">Ajoutez les personnes du foyer dans les réglages pour répartir les charges.</div>
          )}
          {calc.parMembre.map((m) => (
            <div className="corps" key={m.id} style={{ borderBottom: "1px solid var(--filet-fin)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div className="ligne-lib" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="pastille" style={{ background: teinteMembre(etat.membres, m.id) }} />
                    {m.nom}
                  </div>
                  <div className="ligne-meta">
                    Revenus {euro(m.revenu + m.bonus)}{m.salaireReel ? " (paie reçue)" : ""} · quote-part {Math.round(m.part * 100)} % ({euro(m.du)}) · perso {euro(m.perso)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="stat-lib">Il lui reste</div>
                  <div className="chiffre" style={{ fontSize: 20, fontWeight: 650, color: m.reste < 0 ? "var(--brique)" : "var(--caisse)" }}>{euro(m.reste)}</div>
                </div>
              </div>
              <Jauge pct={((m.du + m.perso) / Math.max(1, m.revenu + m.bonus)) * 100} couleur={teinteMembre(etat.membres, m.id)} />
            </div>
          ))}
        </Carte>
      </div>

      <NouvelleOperation ouvert={ajout} onFermer={() => setAjout(false)} etat={etat} calc={calc} mois={mois} executer={executer} />
    </>
  );
}
