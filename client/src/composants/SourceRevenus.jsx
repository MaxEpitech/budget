// Revenus et charges du foyer : synchronisés depuis la banque, ou saisis à la main.
//
// Les deux modes écrivent au même endroit — l'état unique du simulateur, tenu
// par l'écran Capacité d'emprunt. Ce composant ne garde pour lui que ce qui relève de
// l'écran : où en est la liaison, la liste des banques, un appel en cours.
//
// La synchronisation est facultative à deux titres : l'utilisateur peut la
// refuser, et un foyer sans prestataire bancaire configuré ne la voit pas.
import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import Icone from "./Icone.jsx";
import { euro, ilYA } from "../utiles.js";
import { lireFichier, analyserReleve, FORMATS_RELEVE } from "../releve.js";
import { ecran } from "../navigation.js";

/**
 * @param saisie    l'état du simulateur (lecture) : `source`, `banque`, `foyer`
 * @param onChange  fusionne un fragment dans cet état
 * @param signaler  remonte une erreur à l'application (session tombée comprise)
 */
// À qui peut être le compte d'un relevé, vu du simulateur.
const TITULAIRES = { principal: "Compte de l'emprunteur principal", co: "Compte du co-emprunteur", commun: "Compte commun" };

const REFUS = "La banque n'a pas confirmé l'accès. Vous pouvez relancer la connexion.";

/** Revient-on de la banque ? Chaque prestataire a sa forme d'adresse de retour. */
export const retourDeBanque = () =>
  window.location.pathname.replace(/\/+$/, "") === "/banque/retour" ||
  new URLSearchParams(window.location.search).has("banque");

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
          // Ce que la banque a ajouté à l'adresse de retour, quand il y en a.
          const retour = new URLSearchParams(window.location.search);
          s = await api.banqueConfirmer({ code: retour.get("code"), state: retour.get("state"), error: retour.get("error") });
          if (s.refusee && vivant.current) setMessage({ ton: "alerte", texte: s.raison ?? REFUS });
        }
        if (!vivant.current) return;
        setStatut(s);
        if (s.active) await chargerDonnees();
        else if (synchronise && !s.enAttente) onChange({ source: "manuel", banque: null });
      } catch (err) {
        if (vivant.current) setStatut((s) => s ?? { disponible: false });
        surErreur(err);
      } finally {
        // L'adresse de retour a fait son office : inutile d'y laisser un code
        // à usage unique, qu'un rechargement rejouerait.
        // On reste sur le simulateur, à sa vraie adresse.
        if (retourDeBanque()) window.history.replaceState({}, "", ecran("emprunt").chemin);
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
      // On quitte l'application pour la banque ; le retour se fait sur le
      // simulateur, et la saisie en cours est conservée par le navigateur.
      window.location.assign(link);
    });

  const reprendre = () =>
    agir(async () => {
      const s = await api.banqueConfirmer();
      setStatut(s);
      if (s.active) await chargerDonnees();
      else if (s.refusee) setMessage({ ton: "alerte", texte: s.raison ?? REFUS });
      else setMessage({ ton: "alerte", texte: "La banque n'a pas encore confirmé l'accès." });
    });

  const dissocier = () =>
    agir(async () => {
      await api.banqueDissocier();
      setStatut((s) => ({ ...s, active: false, reliee: false, enAttente: false, synchroniseLe: null }));
      onChange({ source: "manuel", banque: null });
      setMessage({ ton: "ok", texte: "Banque dissociée : l'accès à vos comptes a été retiré." });
    });

  // Estimation à partir de relevés : une aide à la saisie, pas une source à
  // part — les champs sont remplis, et restent modifiables.
  //
  // Avec des comptes séparés il y a un relevé par personne. Chacun a donc sa
  // case : le revenu va à son titulaire, et les charges s'additionnent. Les
  // garder par titulaire permet de réimporter un relevé sans le compter deux fois.
  const champFichier = useRef(null);
  const [titulaire, setTitulaire] = useState("principal");
  const releves = saisie.releves ?? {};

  const appliquerReleves = (suivants) => {
    const somme = (...valeurs) => Math.round(valeurs.reduce((s, v) => s + (v ?? 0), 0) * 100) / 100;
    const foyer = { ...saisie.foyer };
    // Un compte commun reçoit souvent les deux salaires : ils rejoignent le
    // revenu de l'emprunteur principal, le total du foyer étant ce qui compte.
    if (suivants.principal || suivants.commun) foyer.principal = String(somme(suivants.principal?.revenus, suivants.commun?.revenus));
    if (suivants.co) foyer.co = String(suivants.co.revenus);
    if (Object.keys(suivants).length > 0) foyer.charges = String(somme(...Object.values(suivants).map((r) => r.charges)));
    onChange({ foyer, releves: suivants });
  };

  const estimerDepuisReleve = (e) => {
    const fichier = e.target.files?.[0];
    e.target.value = "";
    if (!fichier) return;
    agir(async () => {
      const r = await analyserReleve(await lireFichier(fichier));
      if (!vivant.current) return;
      appliquerReleves({
        ...releves,
        [titulaire]: { nom: r.nom ?? "relevé", revenus: r.foyer.emprunteurPrincipalNet, charges: r.foyer.chargesCourantesFixes, jours: r.periode.jours },
      });
      const resume = `Relevé lu (${r.periode.jours} jours) : ${r.detail.nbRevenus} versement${r.detail.nbRevenus > 1 ? "s" : ""} de salaire, ${r.detail.nbChargesRecurrentes} dépense${r.detail.nbChargesRecurrentes > 1 ? "s" : ""} récurrente${r.detail.nbChargesRecurrentes > 1 ? "s" : ""}.`;
      setMessage({
        ton: r.avertissements.length ? "alerte" : "ok",
        texte: [resume, ...r.avertissements, "Corrigez les montants si besoin. Pour ajouter ces opérations au budget, importez le relevé depuis l'écran Opérations."].join(" "),
      });
    });
  };

  const retirerReleve = (cle) => {
    const { [cle]: _retire, ...restants } = releves;
    appliquerReleves(restants);
  };

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
            Activer la synchronisation bancaire automatique
            {statut && !statut.disponible && (
              <span style={{ display: "block", fontSize: 12.5, color: "var(--doux)" }}>
                Pas encore configurée pour ce foyer : un propriétaire peut la régler dans
                Réglages › Banque. La saisie manuelle reste disponible.
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

        {!lectureSeule && (
          <div style={{ marginTop: 14 }}>
            <input ref={champFichier} type="file" accept={FORMATS_RELEVE} onChange={estimerDepuisReleve} hidden />
            <div className="forme">
              <Champ
                libelle="Estimer depuis le relevé du" valeur={titulaire} onChange={setTitulaire} largeur={250} disabled={occupe}
                options={Object.entries(TITULAIRES).map(([v, l]) => ({ v, l }))}
              />
              <button className="btn fant" onClick={() => champFichier.current?.click()} disabled={occupe}>
                Choisir un relevé (CSV, Excel, OFX, QIF)
              </button>
            </div>
            {Object.keys(releves).length > 0 && (
              <div className="carte-note" style={{ marginTop: 8 }}>
                {Object.entries(releves).map(([cle, r]) => (
                  <div key={cle} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>
                      {TITULAIRES[cle]} — {r.nom} : {euro(r.revenus)} de revenus, {euro(r.charges)} de charges par mois
                    </span>
                    <button className="suppr" style={{ opacity: 1 }} onClick={() => retirerReleve(cle)} aria-label={`Retirer le relevé : ${TITULAIRES[cle]}`}><Icone nom="fermer" taille={14} /></button>
                  </div>
                ))}
                <div style={{ marginTop: 4 }}>
                  Avec des comptes séparés, ajoutez le relevé de chacun : les revenus vont à leur titulaire, les
                  charges s'additionnent.
                </div>
              </div>
            )}
          </div>
        )}

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
