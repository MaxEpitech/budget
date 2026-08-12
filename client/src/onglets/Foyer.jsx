// Onglet Foyer — logique du prototype ; seules les écritures passent par l'API.
// Les deux boutons « Données » recréent l'état voulu via les routes CRUD :
// il n'existe pas d'endpoint de réinitialisation dédié.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import BoutonConfirme from "../composants/BoutonConfirme.jsx";
import Acces from "../composants/Acces.jsx";
import Sessions from "../composants/Sessions.jsx";
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
      <button className="btn fant mini" onClick={telecharger} disabled={occupe}>
        {occupe ? "Préparation…" : "Télécharger mes données"}
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
      <button className="btn fant mini" onClick={() => setOuvert(true)}>
        Supprimer mon compte
      </button>
    );
  }

  return (
    <div style={{ width: "100%", marginTop: 6, padding: 14, border: "1px solid var(--brique)", borderRadius: 6 }}>
      <div className="ligne-lib" style={{ color: "var(--brique)" }}>Supprimer définitivement ce compte</div>
      <div className="carte-note" style={{ marginTop: 4 }}>
        Le foyer entier disparaît : membres, transactions, crédits, projets, épargne. Rien n'est
        conservé et rien ne pourra être récupéré. Pensez à télécharger vos données avant.
      </div>
      {erreur && <div className="avis alerte" role="alert">{erreur}</div>}
      <div className="forme" style={{ marginTop: 12 }}>
        <Champ
          libelle="Votre mot de passe" type="password" valeur={motDePasse} onChange={setMotDePasse}
          largeur={220} onEntree={supprimer} attributs={{ autoComplete: "current-password" }}
        />
        <button className="btn mini" style={{ background: "var(--brique)" }} onClick={supprimer} disabled={occupe || !motDePasse}>
          {occupe ? "Suppression…" : "Supprimer définitivement"}
        </button>
        <button className="btn fant mini" onClick={() => { setOuvert(false); setMotDePasse(""); setErreur(null); }}>
          Annuler
        </button>
      </div>
    </div>
  );
}

export default function Foyer({ etat, calc, executer, modifier, changerRepartition, compte, onDeconnexion, onCompteSupprime, ouvrirPage }) {
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

      <Acces membres={etat.membres} />

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
        <Sessions />
        <div className="corps" style={{ borderTop: "1px solid var(--filet-fin)" }}>
          <div className="carte-note">
            Vos données vous appartiennent : vous pouvez les emporter, et faire disparaître ce compte
            quand vous voulez.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <BoutonTelecharger />
            <SupprimerCompte onSupprime={onCompteSupprime} />
          </div>
          <div className="carte-note" style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="lien" style={{ fontSize: 12 }} onClick={() => ouvrirPage("confidentialite")}>
              Politique de confidentialité
            </button>
            <button className="lien" style={{ fontSize: 12 }} onClick={() => ouvrirPage("mentions-legales")}>
              Mentions légales
            </button>
          </div>
        </div>
      </Carte>

      <Carte titre="Données">
        <div className="corps">
          <div className="carte-note">
            Tout est enregistré dans la base du foyer, rien n'est gardé dans le navigateur. Le jeu de départ est fictif : remplacez-le par vos chiffres.
          </div>
          {/* Ces deux boutons effacent tout le foyer. Ils demandent donc
              confirmation sur place, et rien ne les rend annulables ensuite —
              contrairement à la suppression d'une ligne. */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <BoutonConfirme
              libelle="Recharger les données d'exemple"
              confirmation="Remplacer tout le budget"
              disabled={occupe}
              onConfirme={() => lancer(recreerDemo)}
            />
            <BoutonConfirme
              libelle="Repartir de zéro"
              confirmation="Tout effacer"
              disabled={occupe}
              onConfirme={() => lancer(toutSupprimer)}
            />
          </div>
        </div>
      </Carte>
    </>
  );
}
