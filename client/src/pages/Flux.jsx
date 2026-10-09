// Opérations — les revenus et dépenses du mois, réguliers ou ponctuels, et les
// mouvements internes : ce qui part vers l'épargne, un projet ou un crédit.
//
// L'écran ne montre que les lignes : l'ajout et l'import s'ouvrent à la
// demande, les enveloppes et la répartition entre membres ont leur propre
// place (Enveloppes, Vue d'ensemble).
import { useState } from "react";
import Carte from "../composants/Carte.jsx";
import Tuile from "../composants/Tuile.jsx";
import Icone from "../composants/Icone.jsx";
import Segments from "../composants/Segments.jsx";
import EtatVide from "../composants/EtatVide.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import Dialogue from "../composants/Dialogue.jsx";
import ImportReleve from "../composants/ImportReleve.jsx";
import NouvelleOperation, { RYTHMES } from "../composants/NouvelleOperation.jsx";
import { euro, libelleMois, teinteMembre, couleurBudget } from "../utiles.js";
import { NATURES, mouvementsInternesDuMois, libelleMouvement } from "../interne.js";

/** « tous les 3 mois · depuis mars 2026 · jusqu'à juin 2027 » */
function decrireRythme(t) {
  const rythme = RYTHMES.find((r) => r.cle === t.periodicite)?.nom ?? "Tous les mois";
  const morceaux = [rythme.toLowerCase()];
  if (t.debut) morceaux.push(`depuis ${libelleMois(t.debut).toLowerCase()}`);
  if (t.fin) morceaux.push(`jusqu'à ${libelleMois(t.fin).toLowerCase()}`);
  return morceaux.join(" · ");
}

const FILTRES = [
  { v: "tout", l: "Tout" },
  { v: "depense", l: "Dépenses" },
  { v: "revenu", l: "Revenus" },
  { v: "interne", l: "Internes" },
];

const jourMois = (iso) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

export default function Flux({ etat, calc, mois, executer, supprimer, naviguer }) {
  const [ajout, setAjout] = useState(false);
  const [importer, setImporter] = useState(false);
  const [filtre, setFiltre] = useState("tout");

  const retirer = (t) => supprimer("transactions", t.id, t.libelle);
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");

  // Une dépense qui pioche dans une enveloppe le montre : la catégorie prend
  // la couleur de l'enveloppe, et son taux de remplissage. Sans cela il fallait
  // aller voir les enveloppes pour savoir si une ligne posait problème.
  const enveloppes = new Map((etat.budgets ?? []).map((b) => [b.categorie, b]));
  const etiquetteCategorie = (t) => {
    const b = t.type === "depense" ? enveloppes.get(t.categorie) : null;
    if (!b) return <span className="etiq">{t.categorie}</span>;
    const part = b.montant > 0 ? b.consomme / b.montant : 0;
    return (
      <span
        className="etiq budget chiffre"
        style={{ "--teinte": couleurBudget(part) }}
        title={`Enveloppe ${t.categorie} : ${euro(b.consomme)} sur ${euro(b.montant)}`}
      >
        {t.categorie} {Math.round(part * 100)} %
      </span>
    );
  };

  const visibles = calc.actifs.filter((t) => filtre === "tout" || t.type === filtre);
  const internes = mouvementsInternesDuMois(etat, mois);
  const recurrents = visibles.filter((t) => t.recurrent);
  const ponctuels = visibles.filter((t) => !t.recurrent);
  const autresRevenus = calc.revenus - calc.salaires;
  // D'où vient le chiffre : les paies du mois, la référence des réglages, ou les deux.
  const recues = calc.parMembre.filter((m) => m.salaireReel).length;
  const noteSalaires =
    recues === 0 ? "Salaires de référence (Réglages › Foyer)"
    : recues === calc.parMembre.length ? "Paies reçues ce mois-ci"
    : `Paie reçue pour ${recues} personne${recues > 1 ? "s" : ""}, référence pour les autres`;
  const nbDepenses = calc.actifs.filter((t) => t.type === "depense").length;

  const ligne = (t) => (
    <div className="ligne" key={t.id}>
      <span className="ligne-avatar" data-type={t.type} aria-hidden="true">
        <Icone nom={t.type === "revenu" ? "entree" : "depense"} taille={16} />
      </span>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div className="ligne-lib">{t.libelle}</div>
        <div className="ligne-meta ligne-etiquettes">
          <span className="etiq perso" style={{ "--teinte": teinteMembre(etat.membres, t.pour) }}>{nomDe(t.pour)}</span>
          {etiquetteCategorie(t)}
          {t.recurrent && <span>{decrireRythme(t)}</span>}
        </div>
      </div>
      <div className={`pousse chiffre montant${t.type === "revenu" ? " pos" : ""}`}>
        {t.type === "revenu" ? "+" : "−"}{euro(t.montant)}
      </div>
      <button className="suppr" onClick={() => retirer(t)} aria-label={`Supprimer ${t.libelle}`}>
        <Icone nom="corbeille" taille={16} />
      </button>
    </div>
  );

  // Un mouvement interne n'est ni compté ni signé comme une dépense : la flèche
  // dit seulement dans quel sens l'argent a circulé.
  const ligneInterne = (m) => {
    const nature = NATURES[m.nature];
    return (
      <div className="ligne" key={`${m.nature}-${m.id}`}>
        <span className="ligne-avatar" data-type="interne" style={{ "--teinte": nature.teinte }} aria-hidden="true">
          <Icone nom={nature.icone} taille={16} />
        </span>
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="ligne-lib">{libelleMouvement(m)}</div>
          <div className="ligne-meta ligne-etiquettes">
            <span className="etiq perso" style={{ "--teinte": teinteMembre(etat.membres, m.pour) }}>{nomDe(m.pour)}</span>
            <button className="etiq perso etiq-lien" style={{ "--teinte": nature.teinte }} onClick={() => naviguer(nature.ecran)}
              title={`Voir dans ${nature.nom === "Projet" ? "Projets" : nature.nom === "Crédit" ? "Crédits" : nature.nom}`}>
              {nature.nom} · {m.cible.libelle}
            </button>
            <span>le {jourMois(m.date)}</span>
            {m.importe && <span>· importé</span>}
          </div>
        </div>
        <div className="pousse chiffre montant interne">
          {m.sortie ? "→ " : "← "}{euro(m.montant)}
        </div>
        <button className="suppr" onClick={() => executer(m.supprimer)} aria-label={`Supprimer ${libelleMouvement(m)}`}>
          <Icone nom="corbeille" taille={16} />
        </button>
      </div>
    );
  };

  const boutonAjout = (
    <button className="btn" onClick={() => setAjout(true)}>
      <Icone nom="plus" /> Nouvelle opération
    </button>
  );

  return (
    <>
      <EnTetePage
        titre="Opérations"
        description={`Revenus, dépenses et mouvements internes de ${libelleMois(mois).toLowerCase()}`}
        actions={
          <>
            <button className="btn fant" onClick={() => setImporter(true)}>
              <Icone nom="importer" /> Importer un relevé
            </button>
            {boutonAjout}
          </>
        }
      />

      <div className="tuiles trois">
        <Tuile
          libelle="Salaires" icone="foyer" teinte="var(--reste)" valeur={euro(calc.salaires)}
          note={noteSalaires} onClick={() => naviguer("foyer")}
        />
        <Tuile libelle="Autres revenus" icone="entree" teinte="var(--reste)" valeur={euro(autresRevenus)} note="Primes, locations, remboursements…" />
        <Tuile libelle="Dépenses" icone="depense" teinte="var(--depenses)" valeur={euro(calc.depenses)} note={`${nbDepenses} ligne${nbDepenses > 1 ? "s" : ""} ce mois-ci`} />
      </div>

      {calc.actifs.length === 0 && internes.length === 0 ? (
        <Carte>
          <EtatVide
            icone="operations"
            titre="Aucune opération ce mois-ci"
            texte="Saisissez vos charges fixes une fois pour toutes — loyer, énergie, abonnements — ou importez le relevé de votre banque."
            action={boutonAjout}
          />
        </Carte>
      ) : (
        <>
          <div className="barre-outils">
            <Segments libelle="Filtrer les opérations" valeur={filtre} onChange={setFiltre} options={FILTRES} />
          </div>

          {filtre !== "interne" && (
            <>
              <Carte
                titre="Régulières"
                note={`${recurrents.length} échéance${recurrents.length > 1 ? "s" : ""} ce mois-ci · saisies une fois, elles reviennent seules`}
              >
                {recurrents.length === 0 && <div className="vide">Aucune ligne régulière{filtre !== "tout" ? " de ce type" : ""}.</div>}
                {recurrents.map(ligne)}
              </Carte>

              <Carte titre="Ponctuelles" note={`Propres à ${libelleMois(mois).toLowerCase()}`}>
                {ponctuels.length === 0 && <div className="vide">Rien d'exceptionnel ce mois-ci.</div>}
                {ponctuels.map(ligne)}
              </Carte>
            </>
          )}

          {(filtre === "tout" || filtre === "interne") && (
            <Carte
              titre="Mouvements internes"
              note="Vers l'épargne, un projet ou un crédit · ils ne comptent pas comme dépenses : le versement prévu ou l'échéance est déjà dans le budget"
            >
              {internes.length === 0 && (
                <div className="vide">Aucun mouvement interne ce mois-ci. Choisissez « Interne » en ajoutant une opération.</div>
              )}
              {internes.map(ligneInterne)}
            </Carte>
          )}
        </>
      )}

      <NouvelleOperation ouvert={ajout} onFermer={() => setAjout(false)} etat={etat} calc={calc} mois={mois} executer={executer} />

      <Dialogue
        large
        ouvert={importer}
        onFermer={() => setImporter(false)}
        titre="Importer un relevé bancaire"
        note="Fichier CSV, Excel (.xlsx), OFX ou QIF téléchargé depuis votre espace bancaire"
      >
        <ImportReleve etat={etat} creditsEnCours={calc.creditsActifs.filter((c) => !c.solde)} executer={executer} />
      </Dialogue>
    </>
  );
}
