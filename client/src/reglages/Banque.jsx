// Identifiants du foyer chez son prestataire bancaire : de quoi proposer la
// synchronisation sans toucher à l'hébergement.
//
// Deux prestataires possibles, un seul à la fois : Enable Banking, ouvert aux
// particuliers pour leurs propres comptes, et GoCardless, qui n'accepte plus de
// nouvelles inscriptions mais sert encore ceux qui y ont déjà un compte.
//
// Aucun secret n'est relu depuis le serveur : une fois enregistré, l'écran n'en
// connaît plus que l'existence. Pour le changer, on le ressaisit.
import { useState, useEffect } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import BoutonConfirme from "../composants/BoutonConfirme.jsx";
import Icone from "../composants/Icone.jsx";

const NOMS = { enablebanking: "Enable Banking", gocardless: "GoCardless" };
const VIDE = { fournisseur: "enablebanking", appId: "", clePrivee: "", fichier: "", secretId: "", secretKey: "" };

function ReglagesBanque() {
  const [config, setConfig] = useState(null); // null : pas encore connu
  const [f, setF] = useState(VIDE);
  const [edition, setEdition] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton: "ok" | "alerte", texte }

  useEffect(() => {
    let vivant = true;
    api.banqueConfiguration().then(
      (c) => vivant && setConfig(c),
      (err) => vivant && setMessage({ ton: "alerte", texte: err.message }),
    );
    return () => { vivant = false; };
  }, []);

  const agir = async (action, reussite) => {
    setOccupe(true);
    setMessage(null);
    try {
      const c = await action();
      setConfig(c);
      setF(VIDE);
      setEdition(false);
      // Identifiants acceptés mais réglage incomplet chez le prestataire : c'est
      // lui qu'il faut lire, pas un simple « enregistré ».
      setMessage(c.avertissement ? { ton: "alerte", texte: c.avertissement } : { ton: "ok", texte: reussite });
    } catch (err) {
      setMessage({ ton: "alerte", texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  // La clé privée est un fichier .pem : le lire ici évite d'avoir à en copier le
  // contenu à la main. Il ne quitte le navigateur qu'à l'enregistrement.
  const lireFichier = async (e) => {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    // Enable Banking nomme le fichier d'après l'identifiant de l'application :
    // autant le préremplir.
    const devine = /^([0-9a-f-]{36})\.pem$/i.exec(fichier.name)?.[1];
    const clePrivee = await fichier.text();
    setF((avant) => ({ ...avant, clePrivee, fichier: fichier.name, appId: avant.appId || devine || "" }));
  };

  const eb = f.fournisseur === "enablebanking";
  const complet = eb ? f.appId.trim() && f.clePrivee.trim() : f.secretId.trim() && f.secretKey.trim();

  const enregistrer = () => {
    if (!complet) return;
    agir(
      () => api.banqueConfigurer(
        eb
          ? { fournisseur: "enablebanking", appId: f.appId.trim(), clePrivee: f.clePrivee.trim() }
          : { fournisseur: "gocardless", secretId: f.secretId.trim(), secretKey: f.secretKey.trim() },
      ),
      `Identifiants vérifiés auprès de ${NOMS[f.fournisseur]} et enregistrés. La synchronisation s'active depuis l'écran Capacité d'emprunt.`,
    );
  };

  if (!config) {
    return message ? (
      <Carte titre="Synchronisation bancaire"><div className="corps"><div className="avis alerte" role="alert" style={{ marginTop: 0 }}>{message.texte}</div></div></Carte>
    ) : null;
  }

  const duFoyer = config.source === "foyer";
  const formulaire = config.peutModifier && config.enregistrementPossible && (edition || !duFoyer);

  return (
    <Carte
      titre="Synchronisation bancaire"
      note={
        duFoyer ? `${NOMS[config.fournisseur]} — identifiants du foyer enregistrés (${config.identifiant})`
        : config.source === "installation" ? `Assurée par les identifiants ${NOMS[config.fournisseur]} de l'installation`
        : "Non configurée — les revenus et charges se saisissent à la main"
      }
    >
      <div className="corps">
        <div className="carte-note">
          Pour lire revenus et charges sur un compte bancaire, le foyer passe par un prestataire agréé, auprès
          duquel il crée ses propres identifiants. Ils servent à tous les comptes du foyer.
        </div>

        {message && <div className={`avis ${message.ton}`} role={message.ton === "alerte" ? "alert" : "status"}>{message.texte}</div>}

        {!config.peutModifier && (
          <div className="carte-note" style={{ marginTop: 10 }}>Seul un propriétaire du foyer peut modifier ce réglage.</div>
        )}
        {config.peutModifier && !config.enregistrementPossible && (
          <div className="avis alerte">
            Enregistrement impossible pour l'instant : la clé de chiffrement n'est pas configurée sur le serveur
            (variable CLE_CHIFFREMENT). Elle protège les identifiants une fois en base.
          </div>
        )}

        {formulaire && (
          <>
            <div className="forme" style={{ marginTop: 14 }}>
              <Champ
                libelle="Prestataire" valeur={f.fournisseur} onChange={(v) => setF({ ...VIDE, fournisseur: v })} largeur={280}
                options={[{ v: "enablebanking", l: "Enable Banking" }, { v: "gocardless", l: "GoCardless (comptes existants)" }]}
              />
            </div>

            {eb ? (
              <>
                <ol className="carte-note" style={{ margin: "12px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Créez une application dans le panneau Enable Banking, en environnement de production.</li>
                  <li>
                    Déclarez-y cette adresse de retour (« redirect URL ») :{" "}
                    <code style={{ userSelect: "all", wordBreak: "break-all" }}>{config.redirections.enablebanking}</code>
                  </li>
                  <li>Liez vos comptes bancaires à l'application : en mode restreint, seuls ceux-là sont lisibles.</li>
                  <li>Indiquez ci-dessous l'identifiant de l'application et le fichier .pem téléchargé à sa création.</li>
                </ol>
                <div className="forme" style={{ marginTop: 14 }}>
                  <Champ
                    libelle="Identifiant de l'application" valeur={f.appId} onChange={(v) => setF({ ...f, appId: v })} largeur={330}
                    placeholder="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" attributs={{ autoComplete: "off", spellCheck: false }}
                  />
                  <label className="champ">
                    <span className="champ-lib">Clé privée (fichier .pem)</span>
                    <input type="file" accept=".pem,.key,application/x-pem-file" onChange={lireFichier} style={{ height: 42, paddingTop: 9, fontSize: 13, maxWidth: 280 }} />
                  </label>
                </div>
                {f.fichier && <div className="carte-note" style={{ marginTop: 6 }}>Clé chargée depuis {f.fichier}.</div>}
              </>
            ) : (
              <>
                <div className="carte-note" style={{ marginTop: 12 }}>
                  GoCardless Bank Account Data n'accepte plus de nouvelles inscriptions. Ce choix ne sert que si
                  vous y avez déjà un compte : le « Secret ID » et la « Secret key » se créent dans son portail,
                  rubrique User secrets.
                </div>
                <div className="forme" style={{ marginTop: 14 }}>
                  <Champ
                    libelle="Secret ID" valeur={f.secretId} onChange={(v) => setF({ ...f, secretId: v })} largeur={280}
                    onEntree={enregistrer} attributs={{ autoComplete: "off", spellCheck: false }}
                  />
                  <Champ
                    libelle="Secret key" type="password" valeur={f.secretKey} onChange={(v) => setF({ ...f, secretKey: v })} largeur={280}
                    onEntree={enregistrer} attributs={{ autoComplete: "new-password" }}
                  />
                </div>
              </>
            )}

            <div className="forme" style={{ marginTop: 14 }}>
              <button className="btn" onClick={enregistrer} disabled={occupe || !complet}>
                {occupe ? "Vérification…" : "Vérifier et enregistrer"}
              </button>
              {edition && <button className="btn fant" onClick={() => { setEdition(false); setF(VIDE); }} disabled={occupe}>Annuler</button>}
              <div className="carte-note" style={{ flexBasis: "100%" }}>
                Les identifiants sont essayés auprès du prestataire avant d'être gardés. Le secret est chiffré en
                base et ne sera plus jamais affiché.
                {duFoyer && " Les remplacer défait les banques déjà reliées par les comptes du foyer : il faudra les relier de nouveau."}
              </div>
            </div>
          </>
        )}

        {config.peutModifier && duFoyer && !edition && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
            {config.enregistrementPossible && (
              <button className="btn fant mini" onClick={() => { setEdition(true); setMessage(null); }} disabled={occupe}>Remplacer</button>
            )}
            {/* Retirer les identifiants défait aussi les banques reliées : le
                geste demande donc confirmation sur place. */}
            <BoutonConfirme
              libelle="Retirer les identifiants"
              confirmation="Retirer, et dissocier les banques du foyer"
              disabled={occupe}
              onConfirme={() => agir(api.banqueDeconfigurer, "Identifiants retirés. Les banques reliées par les comptes du foyer ont été dissociées.")}
            />
          </div>
        )}
      </div>
    </Carte>
  );
}

/**
 * Réglages › Banque : le prestataire de synchronisation, et l'autre chemin —
 * le relevé téléchargé, qui marche avec toutes les banques sans rien régler.
 * Le rappeler ici évite de croire qu'il faut un prestataire pour commencer.
 */
export default function Banque({ naviguer }) {
  return (
    <>
      <ReglagesBanque />
      <Carte titre="Sans prestataire : le relevé" note="Fonctionne avec toutes les banques, sans aucun réglage">
        <div className="corps">
          <div className="carte-note" style={{ marginBottom: 12 }}>
            Un relevé CSV, OFX ou QIF téléchargé depuis votre espace bancaire fait le même office : ses
            opérations entrent dans le budget après votre validation, ou servent à estimer revenus et
            charges dans le simulateur.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn fant" onClick={() => naviguer("operations")}>
              <Icone nom="importer" /> Importer dans les opérations
            </button>
            <button className="btn fant" onClick={() => naviguer("emprunt")}>
              <Icone nom="capacite" /> Estimer ma capacité d'emprunt
            </button>
          </div>
        </div>
      </Carte>
    </>
  );
}
