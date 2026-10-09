// Historique — l'application ne montrait qu'un mois, sans jamais comparer.
import { useState, useEffect } from "react";
import { api } from "../api.js";
import Carte from "../composants/Carte.jsx";
import Segments from "../composants/Segments.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { euro, libelleMois, POSTES } from "../utiles.js";

// Ce qui compose une colonne, dans l'ordre où on l'empile. Le reste à vivre
// coiffe le tout : c'est la part qui reste quand tout le reste est payé.
const POSTES_EMPILES = ["depenses", "credits", "projets", "placements", "reste"];

const HORIZONS = [
  { mois: 6, nom: "6 mois" },
  { mois: 12, nom: "12 mois" },
  { mois: 24, nom: "24 mois" },
];

export default function Historique({ mois }) {
  const [horizon, setHorizon] = useState(12);
  const [serie, setSerie] = useState(null);
  const [erreur, setErreur] = useState(null);

  useEffect(() => {
    let vivant = true;
    setErreur(null);
    api.historique(mois, horizon).then(
      (r) => vivant && setSerie(r.serie),
      (e) => vivant && setErreur(e.message),
    );
    return () => { vivant = false; };
  }, [mois, horizon]);

  const entete = (
    <EnTetePage
      titre="Historique"
      description={serie ? `Du ${libelleMois(serie[0].mois).toLowerCase()} à ${libelleMois(serie[serie.length - 1].mois).toLowerCase()}` : "Les mois passés, côte à côte"}
      actions={
        <Segments
          libelle="Période affichée" valeur={horizon} onChange={setHorizon}
          options={HORIZONS.map((h) => ({ v: h.mois, l: h.nom }))}
        />
      }
    />
  );

  if (erreur) {
    return (
      <>
        {entete}
        <Carte>
          <div className="corps"><div className="avis alerte" style={{ marginTop: 0 }}>{erreur}</div></div>
        </Carte>
      </>
    );
  }
  if (!serie) {
    return <>{entete}<Carte><div className="vide">Chargement…</div></Carte></>;
  }

  // L'échelle est commune à toutes les colonnes, sans quoi la hauteur ne voudrait
  // rien dire d'un mois à l'autre.
  const plafond = Math.max(
    ...serie.map((m) => Math.max(m.revenus, m.depenses + m.credits + m.projets + m.placements)),
    1,
  );

  const moyenne = (cle) => serie.reduce((s, m) => s + m[cle], 0) / serie.length;
  const courant = serie[serie.length - 1];
  const ecart = courant.reste - moyenne("reste");

  return (
    <>
      {entete}
      <Carte titre="Évolution" note="Une colonne par mois, à la même échelle">
        <div className="corps">
          <Colonnes serie={serie} plafond={plafond} />
          <div className="legende" style={{ marginTop: 14 }}>
            {POSTES_EMPILES.map((cle) => (
              <span key={cle} className="puce fixe">
                <span className="pastille" style={{ background: `var(${POSTES[cle].var})` }} />
                <span className="puce-lib">{POSTES[cle].nom}</span>
                <span className="puce-val chiffre">{euro(moyenne(cle))}</span>
              </span>
            ))}
          </div>
          <div className="carte-note" style={{ marginTop: 10 }}>
            Les montants affichés dans la légende sont des moyennes sur la période. Une échéance
            annuelle n'est jamais lissée : elle pèse sur le mois où elle tombe.
          </div>
        </div>
      </Carte>

      <div className="duo">
        <Carte titre="Ce mois-ci face à la moyenne">
          <div className="corps">
            <div className="stat-lib">Reste à vivre du mois</div>
            <div className="stat-val chiffre" style={{ color: courant.reste < 0 ? "var(--brique)" : "var(--caisse)" }}>
              {euro(courant.reste)}
            </div>
            <div className={`avis ${ecart >= 0 ? "ok" : "alerte"}`}>
              {Math.abs(ecart) < 1
                ? "Un mois comme les autres."
                : ecart > 0
                  ? `${euro(ecart)} de mieux que la moyenne de la période.`
                  : `${euro(-ecart)} de moins que la moyenne de la période.`}
            </div>
          </div>
        </Carte>

        <Carte titre="Le mois le plus lourd">
          <div className="corps">
            {(() => {
              const pire = serie.reduce((a, b) => (b.reste < a.reste ? b : a));
              const meilleur = serie.reduce((a, b) => (b.reste > a.reste ? b : a));
              return (
                <>
                  <div className="stat-lib">{libelleMois(pire.mois)}</div>
                  <div className="stat-val chiffre" style={{ color: pire.reste < 0 ? "var(--brique)" : undefined }}>
                    {euro(pire.reste)}
                  </div>
                  <div className="carte-note" style={{ marginTop: 6 }}>
                    Le plus favorable : {libelleMois(meilleur.mois).toLowerCase()}, {euro(meilleur.reste)}.
                  </div>
                </>
              );
            })()}
          </div>
        </Carte>
      </div>

      <Carte titre="Mois par mois">
        <div className="corps" style={{ overflowX: "auto" }}>
          <table className="amort" style={{ minWidth: 520 }}>
            <thead>
              <tr>
                <th>Mois</th><th>Revenus</th><th>Dépenses</th><th>Crédits</th><th>Épargne</th><th>Reste</th>
              </tr>
            </thead>
            <tbody>
              {[...serie].reverse().map((m) => (
                <tr key={m.mois}>
                  <td>{libelleMois(m.mois)}</td>
                  <td className="chiffre">{euro(m.revenus)}</td>
                  <td className="chiffre">{euro(m.depenses)}</td>
                  <td className="chiffre">{euro(m.credits)}</td>
                  <td className="chiffre">{euro(m.projets + m.placements)}</td>
                  <td className="chiffre" style={{ fontWeight: 600, color: m.reste < 0 ? "var(--brique)" : undefined }}>
                    {euro(m.reste)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Carte>
    </>
  );
}

/**
 * Une colonne empilée par mois, dans les couleurs de la bande de l'en-tête :
 * le même vocabulaire visuel, à l'échelle d'une année.
 */
function Colonnes({ serie, plafond }) {
  const L = 640, H = 200, basLegende = 24;
  const hauteurUtile = H - basLegende;
  const largeur = L / serie.length;
  const barre = Math.min(34, largeur * 0.62);

  return (
    <svg viewBox={`0 0 ${L} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
      role="img" aria-label={`Évolution du budget sur ${serie.length} mois`}>
      {serie.map((m, i) => {
        const x = i * largeur + (largeur - barre) / 2;
        let y = hauteurUtile;
        return (
          <g key={m.mois}>
            {POSTES_EMPILES.map((cle) => {
              const valeur = cle === "reste" ? Math.max(0, m.reste) : m[cle];
              const hauteur = (valeur / plafond) * hauteurUtile;
              if (hauteur <= 0) return null;
              y -= hauteur;
              return (
                <rect key={cle} x={x} y={y} width={barre} height={hauteur}
                  fill={`var(${POSTES[cle].var})`}>
                  <title>{`${libelleMois(m.mois)} — ${POSTES[cle].nom} : ${euro(valeur)}`}</title>
                </rect>
              );
            })}
            {/* Un mois sur deux quand la série est longue, pour rester lisible. */}
            {(serie.length <= 12 || i % 2 === 0) && (
              <text x={x + barre / 2} y={H - 8} fontSize="10" fill="var(--doux)" textAnchor="middle" fontFamily="var(--mono)">
                {m.mois.slice(5)}/{m.mois.slice(2, 4)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
