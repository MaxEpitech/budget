/**
 * Anneau de répartition — un camembert évidé.
 *
 * Le trou du centre n'est pas décoratif : il porte le total, et c'est lui qu'on
 * lit en premier. Les parts sont séparées d'un mince intervalle, comme les
 * segments de la bande d'en-tête, pour qu'on les compte sans les confondre.
 *
 * Une part minuscule garde une longueur plancher : la faire disparaître
 * laisserait croire qu'elle n'existe pas.
 */
const ECART = 2.5; // intervalle entre deux parts, en unités de circonférence
const PLANCHER = 1.5; // longueur minimale d'une part non nulle

export default function Anneau({ parts, taille = 176, epaisseur = 26, actif, onSurvol, centreHaut, centreBas, titre }) {
  const total = parts.reduce((s, p) => s + p.montant, 0);
  const rayon = (taille - epaisseur) / 2;
  const circonference = 2 * Math.PI * rayon;
  const centre = taille / 2;

  let curseur = 0;
  const arcs = parts.map((p) => {
    const brute = total > 0 ? (p.montant / total) * circonference : 0;
    const arc = {
      ...p,
      debut: curseur,
      longueur: p.montant > 0 ? Math.max(PLANCHER, brute - ECART) : 0,
    };
    curseur += brute;
    return arc;
  });

  return (
    <svg
      className="anneau-svg"
      width={taille}
      height={taille}
      viewBox={`0 0 ${taille} ${taille}`}
      role="img"
      aria-label={titre}
    >
      {/* Le tour part de midi plutôt que de trois heures : c'est de là qu'on
          lit un cadran. */}
      <g transform={`rotate(-90 ${centre} ${centre})`}>
        {arcs.map((a) => (
          <circle
            key={a.cle}
            className="part"
            data-actif={actif === a.cle ? "1" : "0"}
            cx={centre}
            cy={centre}
            r={rayon}
            fill="none"
            stroke={a.couleur}
            strokeWidth={epaisseur}
            strokeDasharray={`${a.longueur} ${Math.max(0, circonference - a.longueur)}`}
            strokeDashoffset={-a.debut}
            onMouseEnter={() => onSurvol?.(a.cle)}
            onMouseLeave={() => onSurvol?.(null)}
          >
            <title>{a.libelle}</title>
          </circle>
        ))}
      </g>
      <text x={centre} y={centre - 2} textAnchor="middle" className="anneau-total chiffre">{centreHaut}</text>
      <text x={centre} y={centre + 17} textAnchor="middle" className="anneau-sous">{centreBas}</text>
    </svg>
  );
}
