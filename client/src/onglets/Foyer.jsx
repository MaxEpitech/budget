// Onglet Foyer — logique du prototype ; seules les écritures passent par l'API.
// Les deux boutons « Données » recréent l'état voulu via les routes CRUD :
// il n'existe pas d'endpoint de réinitialisation dédié.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import { euro, num, moisCle, decalerMois } from "../utiles.js";

// Supprime transactions, crédits, projets et placements (les membres restent).
async function toutSupprimer() {
  const [transactions, credits, projets, placements] = await Promise.all([
    api.transactions(),
    api.credits(),
    api.projets(),
    api.placements(),
  ]);
  await Promise.all([
    ...transactions.map((t) => api.supprimerTransaction(t.id)),
    ...credits.map((c) => api.supprimerCredit(c.id)),
    ...projets.map((p) => api.supprimerProjet(p.id)),
    ...placements.map((p) => api.supprimerPlacement(p.id)),
  ]);
}

// Recrée le jeu d'exemple du prototype (ETAT_DEMO) via l'API.
async function recreerDemo() {
  await toutSupprimer();
  const membres = await api.membres();
  await Promise.all(membres.map((m) => api.supprimerMembre(m.id)));
  await api.modifierFoyer("prorata");

  const alex = await api.creerMembre({ nom: "Alex", revenu: 2450 });
  const camille = await api.creerMembre({ nom: "Camille", revenu: 1980 });

  // Créées séquentiellement, dans l'ordre inverse de l'affichage :
  // l'API sert les transactions de la plus récente à la plus ancienne.
  const transactions = [
    { type: "revenu", libelle: "Freelance", montant: 300, categorie: "Autre", pour: alex.id, recurrent: false, mois: moisCle() },
    { type: "depense", libelle: "Essence", montant: 140, categorie: "Transport", pour: "foyer", recurrent: true },
    { type: "depense", libelle: "Salle de sport", montant: 32, categorie: "Loisirs", pour: camille.id, recurrent: true },
    { type: "depense", libelle: "Forfait mobile", montant: 15, categorie: "Abonnements", pour: alex.id, recurrent: true },
    { type: "depense", libelle: "Assurance habitation", montant: 28, categorie: "Assurances", pour: "foyer", recurrent: true },
    { type: "depense", libelle: "Électricité", montant: 95, categorie: "Énergie", pour: "foyer", recurrent: true },
    { type: "depense", libelle: "Courses", montant: 520, categorie: "Courses", pour: "foyer", recurrent: true },
    { type: "depense", libelle: "Loyer", montant: 980, categorie: "Logement", pour: "foyer", recurrent: true },
  ];
  for (const t of transactions) await api.creerTransaction(t);

  await api.creerCredit({ libelle: "Voiture", capital: 14000, taux: 3.9, duree: 60, debut: decalerMois(moisCle(), -18) });
  await api.creerCredit({ libelle: "Prêt travaux", capital: 9000, taux: 2.4, duree: 48, debut: decalerMois(moisCle(), -6) });

  const japon = await api.creerProjet({ libelle: "Voyage Japon", objectif: 6000, echeance: decalerMois(moisCle(), 14), versement: 250 });
  await api.verser(japon.id, 1850);
  const cuisine = await api.creerProjet({ libelle: "Travaux cuisine", objectif: 12000, echeance: decalerMois(moisCle(), 20), versement: 300 });
  await api.verser(cuisine.id, 3200);

  await api.creerPlacement({ libelle: "Livret A", valeur: 8400, versement: 150, rendement: 2.4 });
  await api.creerPlacement({ libelle: "PEA", valeur: 5200, versement: 200, rendement: 5.5 });
}

export default function Foyer({ etat, calc, executer, modifier, changerRepartition, compte, onDeconnexion }) {
  const [occupe, setOccupe] = useState(false);

  const modifierMembre = (id, patch) => modifier("membres", id, patch);

  const lancer = (action) => {
    setOccupe(true);
    executer(async () => {
      try {
        await action();
      } finally {
        setOccupe(false);
      }
    });
  };

  return (
    <>
      <Carte titre="Les deux revenus" note="Salaires nets mensuels du foyer">
        {etat.membres.map((m) => (
          <div className="ligne" key={m.id}>
            <Champ libelle="Prénom" valeur={m.nom} onChange={(v) => modifierMembre(m.id, { nom: v })} largeur={150} />
            <Champ libelle="Revenu net /mois" valeur={String(m.revenu)} onChange={(v) => modifierMembre(m.id, { revenu: num(v) })} largeur={130} />
            <div className="pousse" style={{ textAlign: "right" }}>
              <div className="stat-lib">Part des revenus</div>
              <div className="chiffre" style={{ fontWeight: 600 }}>
                {calc.salaires ? Math.round((m.revenu / calc.salaires) * 100) : 0}%
              </div>
            </div>
          </div>
        ))}
        <div className="corps">
          <button className="btn fant mini" onClick={() => executer(() => api.creerMembre({ nom: "Nouveau", revenu: 0 }))}>
            Ajouter une personne
          </button>
        </div>
      </Carte>

      <Carte titre="Partage des charges communes">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Méthode" valeur={etat.repartition} onChange={changerRepartition} largeur={230}
              options={[{ v: "prorata", l: "Au prorata des revenus" }, { v: "moitie", l: "Moitié-moitié" }]} />
          </div>
          <div className="carte-note" style={{ marginTop: 10 }}>
            {etat.repartition === "prorata"
              ? "Chacun contribue proportionnellement à ce qu'il gagne. Le reste à vivre est plus équilibré quand les salaires diffèrent."
              : "Chacun paie la même somme, quel que soit son salaire."}
          </div>
        </div>
      </Carte>

      <Carte titre="Compte">
        <div className="corps">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div className="stat-lib">Connecté en tant que</div>
              <div className="ligne-lib">{compte?.email}</div>
            </div>
            <button className="btn fant mini" onClick={onDeconnexion}>Se déconnecter</button>
          </div>
        </div>
      </Carte>

      <Carte titre="Données">
        <div className="corps">
          <div className="carte-note">
            Tout est enregistré dans la base du foyer, rien n'est gardé dans le navigateur. Le jeu de départ est fictif : remplacez-le par vos chiffres.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn fant mini" disabled={occupe} onClick={() => lancer(recreerDemo)}>Recharger les données d'exemple</button>
            <button className="btn fant mini" disabled={occupe} onClick={() => lancer(toutSupprimer)}>
              Repartir de zéro
            </button>
          </div>
        </div>
      </Carte>
    </>
  );
}
