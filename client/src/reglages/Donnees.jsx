// Réglages › Données — emporter ses données, repartir de zéro, ou tout effacer.
// Les deux remises à zéro recréent l'état voulu via les routes CRUD : il
// n'existe pas d'endpoint de réinitialisation dédié.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";
import BoutonConfirme from "../composants/BoutonConfirme.jsx";
import { moisCle, decalerMois } from "../utiles.js";

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

/** Télécharge l'ensemble des données du foyer, dans un fichier lisible. */
function BoutonTelecharger() {
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState(null);

  const telecharger = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      const donnees = await api.mesDonnees();
      const adresse = URL.createObjectURL(
        new Blob([JSON.stringify(donnees, null, 2)], { type: "application/json" }),
      );
      const lien = document.createElement("a");
      lien.href = adresse;
      lien.download = `budget-${new Date().toISOString().slice(0, 10)}.json`;
      lien.click();
      URL.revokeObjectURL(adresse);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <>
      <button className="btn fant" onClick={telecharger} disabled={occupe}>
        <Icone nom="telecharger" /> {occupe ? "Préparation…" : "Télécharger mes données"}
      </button>
      {erreur && <span className="carte-note" style={{ color: "var(--brique)" }}>{erreur}</span>}
    </>
  );
}

/**
 * Suppression du compte : dépliée en deux temps, et le mot de passe est
 * redemandé. C'est le geste le plus irréversible de l'application ; une session
 * restée ouverte sur un poste partagé ne doit pas suffire à l'accomplir.
 */
function SupprimerCompte({ onSupprime }) {
  const [ouvert, setOuvert] = useState(false);
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const supprimer = async () => {
    if (occupe || !motDePasse) return;
    setOccupe(true);
    setErreur(null);
    try {
      await api.supprimerCompte(motDePasse);
      onSupprime();
    } catch (e) {
      setErreur(e.message);
      setOccupe(false);
    }
  };

  if (!ouvert) {
    return (
      <button className="btn danger" onClick={() => setOuvert(true)}>
        <Icone nom="corbeille" /> Supprimer mon compte
      </button>
    );
  }

  return (
    <div style={{ width: "100%" }}>
      <div className="avis alerte" style={{ marginTop: 0 }}>
        Confirmez avec votre mot de passe. Le foyer entier disparaîtra immédiatement.
      </div>
      {erreur && <div className="avis alerte" role="alert">{erreur}</div>}
      <div className="forme" style={{ marginTop: 12 }}>
        <Champ
          libelle="Votre mot de passe" type="password" valeur={motDePasse} onChange={setMotDePasse}
          largeur={220} onEntree={supprimer} attributs={{ autoComplete: "current-password" }}
        />
        <button className="btn danger plein-fond" onClick={supprimer} disabled={occupe || !motDePasse}>
          {occupe ? "Suppression…" : "Supprimer définitivement"}
        </button>
        <button className="btn fant" onClick={() => { setOuvert(false); setMotDePasse(""); setErreur(null); }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function Donnees({ executer, onCompteSupprime, ouvrirPage }) {
  const [occupe, setOccupe] = useState(false);

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
      <Carte titre="Emporter vos données" note="Vos données vous appartiennent">
        <div className="corps">
          <div className="carte-note" style={{ marginBottom: 12 }}>
            Un fichier JSON lisible, avec l'intégralité du foyer : membres, opérations, crédits, projets,
            épargne, enveloppes. Tout est enregistré sur le serveur, rien n'est gardé dans le navigateur.
          </div>
          <BoutonTelecharger />
        </div>
      </Carte>

      <Carte titre="Repartir d'un budget neuf" note="Les membres du foyer et les comptes sont conservés">
        <div className="corps">
          <div className="carte-note" style={{ marginBottom: 12 }}>
            Le jeu d'exemple est fictif : il sert à découvrir l'application. Ces deux actions remplacent tout
            le budget, et ne peuvent pas être annulées — contrairement à la suppression d'une ligne.
          </div>
          {/* Ces deux boutons effacent tout le foyer : ils demandent donc
              confirmation sur place. */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <BoutonConfirme
              libelle="Charger les données d'exemple"
              confirmation="Remplacer tout le budget"
              disabled={occupe}
              onConfirme={() => lancer(recreerDemo)}
            />
            <BoutonConfirme
              libelle="Tout effacer"
              confirmation="Effacer tout le budget"
              disabled={occupe}
              onConfirme={() => lancer(toutSupprimer)}
            />
          </div>
        </div>
      </Carte>

      <section className="carte zone-danger">
        <div className="carte-tete">
          <div>
            <div className="carte-titre">Supprimer le compte</div>
            <div className="carte-note">
              Le foyer entier disparaît : membres, opérations, crédits, projets, épargne. Rien n'est
              conservé et rien ne pourra être récupéré. Pensez à télécharger vos données avant.
            </div>
          </div>
        </div>
        <div className="corps">
          <SupprimerCompte onSupprime={onCompteSupprime} />
        </div>
      </section>

      <div className="liens-legaux">
        <button className="lien" onClick={() => ouvrirPage("confidentialite")}>Politique de confidentialité</button>
        <button className="lien" onClick={() => ouvrirPage("mentions-legales")}>Mentions légales</button>
      </div>
    </>
  );
}
