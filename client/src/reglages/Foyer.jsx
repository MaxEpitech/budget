// Réglages › Foyer — qui compose le foyer, ce que chacun gagne, et comment
// les charges communes se partagent.
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";
import Segments from "../composants/Segments.jsx";
import { euro, num, teinteMembre } from "../utiles.js";

const MODES = [
  { v: "prorata", l: "Au prorata des revenus" },
  { v: "moitie", l: "Moitié-moitié" },
];

export default function Foyer({ etat, calc, executer, modifier, changerRepartition }) {
  const modifierMembre = (id, patch) => modifier("membres", id, patch);

  return (
    <>
      <Carte
        titre="Personnes et revenus"
        note={`${etat.membres.length} personne${etat.membres.length > 1 ? "s" : ""} · salaires de référence, remplacés par la paie du mois dès qu'elle figure dans les opérations`}
        action={
          <button className="btn fant mini" onClick={() => executer(() => api.creerMembre({ nom: "Nouveau", revenu: 0 }))}>
            <Icone nom="plus" taille={16} /> Ajouter une personne
          </button>
        }
      >
        {etat.membres.length === 0 && (
          <div className="vide">Ajoutez les personnes du foyer et leur salaire net : c'est la base de tous les calculs.</div>
        )}
        {etat.membres.map((m) => {
          // Le revenu qui compte ce mois-ci : la paie reçue, ou la référence.
          const duMois = calc.parMembre.find((x) => x.id === m.id);
          return (
          <div className="ligne membre" key={m.id}>
            {/* La même teinte que dans « Qui paie quoi » et sur les étiquettes. */}
            <span className="membre-pastille" style={{ "--teinte": teinteMembre(etat.membres, m.id) }} aria-hidden="true">
              {(m.nom || "?").slice(0, 1)}
            </span>
            <Champ libelle="Prénom" valeur={m.nom} onChange={(v) => modifierMembre(m.id, { nom: v })} largeur={160} />
            <Champ
              libelle="Salaire de référence /mois" valeur={String(m.revenu)} onChange={(v) => modifierMembre(m.id, { revenu: num(v) })}
              largeur={140} attributs={{ inputMode: "decimal" }}
            />
            <div style={{ minWidth: 0 }}>
              <div className="stat-lib">Ce mois-ci</div>
              {duMois?.salaireReel ? (
                <span className="etiq perso" style={{ "--teinte": "var(--caisse)" }}>Paie reçue : {euro(duMois.revenu)}</span>
              ) : (
                <span className="etiq">Référence utilisée</span>
              )}
            </div>
            <div className="pousse" style={{ textAlign: "right" }}>
              <div className="stat-lib">Part des revenus</div>
              <div className="chiffre" style={{ fontWeight: 650, fontSize: 17 }}>
                {calc.salaires ? Math.round(((duMois?.revenu ?? m.revenu) / calc.salaires) * 100) : 0} %
              </div>
            </div>
          </div>
          );
        })}
        <div className="corps carte-note" style={{ borderTop: "1px solid var(--filet-fin)" }}>
          Le salaire de référence est une estimation : dès qu'une opération de catégorie « Salaire » au
          nom de la personne figure dans le flux d'un mois — saisie, ou lue sur son relevé — c'est elle seule
          qui compte ce mois-là. Les autres revenus — primes, locations — s'ajoutent comme des opérations.
        </div>
      </Carte>

      <Carte titre="Partage des charges communes" note="Ce que chacun verse pour ce qui appartient au foyer">
        <div className="corps">
          <Segments libelle="Mode de partage" valeur={etat.repartition} onChange={changerRepartition} options={MODES} />
          <div className="carte-note" style={{ marginTop: 12 }}>
            {etat.repartition === "prorata"
              ? "Chacun contribue proportionnellement à ce qu'il gagne. Le reste à vivre est plus équilibré quand les salaires diffèrent."
              : "Chacun paie la même somme, quel que soit son salaire."}
          </div>
        </div>
      </Carte>
    </>
  );
}
