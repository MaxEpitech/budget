// Revenus et charges du foyer : synchronisés depuis la banque, ou saisis à la main.
//
// Les deux modes écrivent au même endroit — l'état unique du simulateur, tenu
// par l'onglet Emprunt. Ce composant ne garde pour lui que ce qui relève de
// l'écran : où en est la liaison, la liste des banques, un appel en cours.
//
// La synchronisation est facultative à deux titres : l'utilisateur peut la
// refuser, et un déploiement sans clés GoCardless ne la propose pas du tout.
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import { euro, ilYA } from "../utiles.js";

/**
 * @param saisie    l'état du simulateur (lecture) : `source`, `banque`, `foyer`
 * @param onChange  fusionne un fragment dans cet état
 * @param signaler  remonte une erreur à l'application (session tombée comprise)
 */
export default function SourceRevenus({ saisie, onChange, signaler }) {
  const [statut, setStatut] = useState(null); // null : pas encore connu
  const [banques, setBanques] = useState(null);
  const [banqueChoisie, setBanqueChoisie] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton: "ok" | "alerte", texte }
  const vivant = useRef(true);
  useEffect(() => () => { vivant.current = false; }, []);

  const synchronise = saisie.source === "banque";

  // Une erreur d'appel bancaire s'affiche ici, près du geste qui l'a causée ;
  // seule une session tombée remonte à l'application.
  // `signaler` change d'identité à chaque rendu du parent : passer par une
  // référence évite de relancer les effets qui en dépendent.
  const signalerCourant = useRef(signaler);
  signalerCourant.current = signaler;
  const surErreur = useCallback((err) => {
    if (err.nonAutorise) return signalerCourant.current(err);
    if (vivant.current) setMessage({ ton: "alerte", texte: err.message });
  }, []);

  /** Lit les chiffres de la banque et les pose dans l'état du simulateur. */
  const chargerDonnees = useCallback(async () => {
    const d = await api.banqueDonnees();
    if (!vivant.current) return;
    onChange({
      source: "banque",
      banque: {
        revenus: d.foyer.emprunteurPrincipalNet,
        charges: d.foyer.chargesCourantesFixes,
        solde: d.solde,
        synchroniseLe: d.synchroniseLe,
        perime: d.perime,
        detail: d.detail,
      },
    });
  }, [onChange]);

  // Au montage : où en est la liaison ? Une demande restée en attente — retour
  // de la banque, ou onglet refermé en chemin — est confirmée dans la foulée.
  useEffect(() => {
    (async () => {
      try {
        let s = await api.banqueStatut();
        if (s.disponible && s.enAttente) {
          s = await api.banqueConfirmer();
          if (s.refusee && vivant.current) {
            setMessage({ ton: "alerte", texte: "La banque n'a pas confirmé l'accès. Vous pouvez relancer la connexion." });
          }
        }
        if (!vivant.current) return;
        setStatut(s);
        if (s.active) await chargerDonnees();
        else if (synchronise && !s.enAttente) onChange({ source: "manuel", banque: null });
      } catch (err) {
        if (vivant.current) setStatut((s) => s ?? { disponible: false });
        surErreur(err);
      } finally {
        // Le paramètre de retour a fait son office : inutile de le laisser dans
        // la barre d'adresse, où un rechargement le rejouerait.
        if (new URLSearchParams(window.location.search).has("banque")) {
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // La liste des banques n'est demandée qu'au moment où elle sert.
  const besoinBanques = synchronise && statut?.disponible && !statut.reliee && !statut.enAttente;
  useEffect(() => {
    if (!besoinBanques || banques) return;
    api.banqueInstitutions().then((liste) => vivant.current && setBanques(liste), surErreur);
  }, [besoinBanques, banques, surErreur]);

  const agir = async (action) => {
    setOccupe(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      surErreur(err);
    } finally {
      if (vivant.current) setOccupe(false);
    }
  };

  // La case répond tout de suite ; l'appel au serveur suit. S'il échoue, elle
  // revient à sa position précédente plutôt que d'afficher un état faux.
  const basculer = (actif) =>
    agir(async () => {
      const avant = saisie.source;
      onChange({ source: actif ? "banque" : "manuel" });
      if (!statut?.reliee) return;
      try {
        // Revenir à la saisie manuelle garde la liaison : on peut changer
        // d'avis sans repasser par sa banque.
        setStatut(await api.banqueActiver(actif));
        if (actif) await chargerDonnees();
      } catch (err) {
        onChange({ source: avant });
        throw err;
      }
    });

  const connecter = () =>
    agir(async () => {
      if (!banqueChoisie) return;
      const { link } = await api.banqueInitier(banqueChoisie);
      // On quitte l'application pour la banque ; le retour se fait sur l'onglet
      // Emprunt, et la saisie en cours est conservée par le navigateur.
      window.location.assign(link);
    });

  const reprendre = () =>
    agir(async () => {
      const s = await api.banqueConfirmer();
      setStatut(s);
      if (s.active) await chargerDonnees();
      else if (s.refusee) setMessage({ ton: "alerte", texte: "La banque n'a pas confirmé l'accès. Vous pouvez relancer la connexion." });
      else setMessage({ ton: "alerte", texte: "La banque n'a pas encore confirmé l'accès." });
    });

  const dissocier = () =>
    agir(async () => {
      await api.banqueDissocier();
      setStatut((s) => ({ ...s, active: false, reliee: false, enAttente: false, synchroniseLe: null }));
      onChange({ source: "manuel", banque: null });
      setMessage({ ton: "ok", texte: "Banque dissociée : l'accès à vos comptes a été retiré." });
    });

  const majFoyer = (champ) => (v) => onChange({ foyer: { ...saisie.foyer, [champ]: v } });
  const b = saisie.banque;
  const lectureSeule = synchronise && Boolean(b);

  return (
    <Carte
      titre="Revenus et charges du foyer"
      note={
        lectureSeule
          ? `Tirés de vos opérations des 90 derniers jours · synchronisé ${ilYA(b.synchroniseLe)}`
          : "Saisis à la main, ou tirés de votre compte bancaire"
      }
    >
      <div className="corps">
        <label className="bascule" style={{ height: "auto", alignItems: "flex-start", paddingBottom: 4 }}>
          <input
            type="checkbox"
            style={{ marginTop: 2, flexShrink: 0 }}
            checked={synchronise}
            disabled={occupe || !statut?.disponible}
            onChange={(e) => basculer(e.target.checked)}
          />
          <span>
            Activer la synchronisation bancaire automatique (via GoCardless)
            {statut && !statut.disponible && (
              <span style={{ display: "block", fontSize: 12.5, color: "var(--doux)" }}>
                Pas encore configurée pour ce foyer : un propriétaire peut saisir les identifiants
                GoCardless dans l'onglet Foyer. La saisie manuelle reste disponible.
              </span>
            )}
          </span>
        </label>

        {message && <div className={`avis ${message.ton}`} role={message.ton === "alerte" ? "alert" : "status"}>{message.texte}</div>}

        {/* ── Synchronisation demandée, banque pas encore reliée ── */}
        {synchronise && statut?.disponible && !statut.reliee && !statut.enAttente && (
          <div className="forme" style={{ marginTop: 14 }}>
            <Champ
              libelle="Votre banque" valeur={banqueChoisie} onChange={setBanqueChoisie} largeur={260}
              disabled={!banques || occupe}
              options={[{ v: "", l: banques ? "Choisir une banque…" : "Chargement des banques…" }, ...(banques ?? []).map((i) => ({ v: i.id, l: i.nom }))]}
            />
            <button className="btn" onClick={connecter} disabled={!banqueChoisie || occupe}>Se connecter à ma banque</button>
            <div className="carte-note" style={{ flexBasis: "100%" }}>
              Vous serez redirigé vers votre banque pour autoriser un accès en lecture seule. Vos
              identifiants bancaires ne passent jamais par cette application.
            </div>
          </div>
        )}

        {/* ── Consentement demandé, pas encore confirmé par la banque ── */}
        {synchronise && statut?.enAttente && (
          <div className="forme" style={{ marginTop: 14 }}>
            <div className="carte-note" style={{ flexBasis: "100%" }}>L'autorisation auprès de votre banque n'est pas terminée.</div>
            <button className="btn" onClick={reprendre} disabled={occupe}>Vérifier à nouveau</button>
            <button className="btn fant" onClick={dissocier} disabled={occupe}>Abandonner</button>
          </div>
        )}

        {/* ── Valeurs : lues depuis la banque (figées) ou saisies à la main ── */}
        <div className="forme" style={{ marginTop: 14 }}>
          <Champ
            libelle={lectureSeule ? "Revenus détectés /mois" : "Revenu net emprunteur /mois"}
            valeur={lectureSeule ? String(b.revenus) : saisie.foyer.principal}
            onChange={majFoyer("principal")} largeur={190} placeholder="0" disabled={lectureSeule}
          />
          <Champ
            libelle="Revenu net co-emprunteur /mois" valeur={saisie.foyer.co}
            onChange={majFoyer("co")} largeur={210} placeholder="aucun"
          />
          <Champ
            libelle={lectureSeule ? "Dépenses courantes calculées /mois" : "Charges courantes /mois"}
            valeur={lectureSeule ? String(b.charges) : saisie.foyer.charges}
            onChange={majFoyer("charges")} largeur={230} placeholder="0" disabled={lectureSeule}
          />
        </div>

        {lectureSeule && (
          <>
            {b.perime && (
              <div className="avis alerte">
                La banque n'a pas pu être consultée : ces chiffres datent de la dernière synchronisation réussie.
              </div>
            )}
            <div className="carte-note" style={{ marginTop: 10 }}>
              {b.detail.nbRevenus} versement{b.detail.nbRevenus > 1 ? "s" : ""} reconnu{b.detail.nbRevenus > 1 ? "s" : ""} comme revenu
              {" · "}{b.detail.nbChargesRecurrentes} dépense{b.detail.nbChargesRecurrentes > 1 ? "s" : ""} récurrente{b.detail.nbChargesRecurrentes > 1 ? "s" : ""}
              {b.solde != null && ` · solde du compte ${euro(b.solde)}`}.
              {" "}Les dépenses récurrentes comprennent les mensualités de crédit prélevées sur ce compte : si
              vous les saisissez aussi plus bas, elles pèsent deux fois dans le reste à vivre. Le revenu d'un
              co-emprunteur se saisit à la main — un seul compte est relié.
            </div>
            <div style={{ marginTop: 8 }}>
              <button className="lien" onClick={dissocier} disabled={occupe}>Dissocier ma banque</button>
            </div>
          </>
        )}
      </div>
    </Carte>
  );
}
