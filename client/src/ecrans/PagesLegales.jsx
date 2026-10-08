// Mentions légales et politique de confidentialité.
//
// ─── AVERTISSEMENT ────────────────────────────────────────────────────────
// Ces pages contiennent des mentions « À COMPLÉTER » : identité du responsable
// de traitement, base légale, durées de conservation, région d'hébergement.
// Ce sont des décisions, pas du code — les inventer serait pire que de laisser
// le trou visible. Tant qu'elles subsistent, ces pages ne doivent pas être
// publiées telles quelles.
import Cadre from "./Cadre.jsx";

/** Repère visible pour ce qui reste à décider. */
function ACompleter({ children }) {
  return (
    <span
      className="etiq"
      style={{ background: "var(--alerte-fond)", color: "var(--alerte-texte)", fontWeight: 600, letterSpacing: "0.02em" }}
    >
      À COMPLÉTER — {children}
    </span>
  );
}

function Section({ titre, children }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h2
        className="carte-titre"
        style={{ margin: "0 0 8px", fontSize: 12, color: "var(--ardoise)" }}
      >
        {titre}
      </h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.55 }}>{children}</div>
    </section>
  );
}

const paragraphe = { margin: "0 0 10px" };

export function MentionsLegales({ allerVers }) {
  return (
    <Cadre titre="Mentions légales" large retour={() => allerVers("connexion")}>
      <Section titre="Éditeur du service">
        <p style={paragraphe}>
          <ACompleter>nom ou raison sociale, statut, adresse, adresse de contact, et le cas
          échéant numéro d'immatriculation</ACompleter>
        </p>
        <p style={{ ...paragraphe, color: "var(--doux)", fontSize: 13 }}>
          Un service accessible au public doit indiquer qui l'édite et comment le joindre, même
          lorsqu'il est gratuit et tenu par une personne seule.
        </p>
      </Section>

      <Section titre="Hébergement">
        <p style={paragraphe}>
          L'application et son interface sont hébergées par <strong>Vercel</strong>. Les données sont
          conservées dans une base <strong>Postgres gérée par Prisma</strong>. Région
          d'hébergement : <ACompleter>région choisie au déploiement</ACompleter>
        </p>
      </Section>

      <Section titre="Propriété">
        <p style={paragraphe}>
          Les données saisies dans l'application appartiennent à leur auteur. Elles peuvent être
          récupérées à tout moment depuis l'onglet Foyer, et supprimées définitivement avec le
          compte.
        </p>
      </Section>
    </Cadre>
  );
}

export function Confidentialite({ allerVers }) {
  return (
    <Cadre titre="Politique de confidentialité" large retour={() => allerVers("connexion")}>
      <p style={{ ...paragraphe, color: "var(--ardoise)" }}>
        Ce service enregistre le budget d'un foyer. Pris ensemble, revenus, charges, crédits et
        projets dessinent un portrait financier précis : ces données méritent d'être traitées avec
        soin, et de n'être communiquées à personne.
      </p>

      <Section titre="Ce qui est enregistré">
        <p style={paragraphe}>
          <strong>Pour le compte</strong> — l'adresse email, et le mot de passe sous forme
          d'empreinte irréversible. Le mot de passe lui-même n'est jamais stocké, ni consultable.
        </p>
        <p style={paragraphe}>
          <strong>Pour le budget</strong> — les membres du foyer et leurs revenus, les dépenses et
          recettes, les crédits, les projets d'épargne et leurs versements, les supports d'épargne.
        </p>
        <p style={paragraphe}>
          <strong>Si vous reliez votre banque</strong> — c'est facultatif — vos opérations des 90
          derniers jours sont lues pour en tirer un revenu et des charges mensuels. Seuls ces
          totaux, le solde du compte et la date de la lecture sont conservés : aucune opération
          n'est enregistrée, et vos identifiants bancaires ne passent jamais par ce service.
          Dissocier la banque, ou supprimer le compte, retire l'accès et efface ces totaux.
        </p>
        <p style={paragraphe}>
          <strong>Si votre foyer enregistre ses identifiants GoCardless</strong> — la clé est
          conservée chiffrée, avec une clé de chiffrement tenue hors de la base, et n'est plus
          jamais affichée.
        </p>
        <p style={paragraphe}>
          <strong>Dans votre navigateur</strong> — ce que vous saisissez dans l'onglet Emprunt
          reste sur votre appareil et n'est pas envoyé au service.
        </p>
        <p style={paragraphe}>
          <strong>Techniquement</strong> — les sessions ouvertes, et des journaux d'accès contenant
          la date, la route appelée et le code de réponse. Ni mot de passe, ni jeton, ni cookie n'y
          figurent : ils en sont retirés avant écriture.
        </p>
      </Section>

      <Section titre="Pourquoi, et sur quel fondement">
        <p style={paragraphe}>
          Ces données servent uniquement à fournir le service : afficher le budget, calculer les
          quote-parts, permettre la connexion et la récupération d'un mot de passe. Elles ne sont
          ni revendues, ni utilisées à des fins publicitaires, ni analysées à d'autres fins.
        </p>
        <p style={paragraphe}>
          Base légale : <ACompleter>en principe l'exécution du contrat qui vous lie au service, à
          confirmer</ACompleter>
        </p>
      </Section>

      <Section titre="Combien de temps">
        <p style={paragraphe}>
          Les données sont conservées tant que le compte existe, et disparaissent avec lui.
        </p>
        <p style={paragraphe}>
          Durée de conservation d'un compte resté inactif :{" "}
          <ACompleter>durée à fixer, ainsi que le préavis envoyé avant suppression</ACompleter>
        </p>
        <p style={paragraphe}>
          Les liens de confirmation expirent au bout de 24 heures, ceux de réinitialisation au bout
          d'une heure, et les sessions au bout de trente jours.
        </p>
      </Section>

      <Section titre="Qui d'autre y a accès">
        <p style={paragraphe}>
          Personne d'autre que vous ne consulte le contenu de votre budget. Des prestataires
          interviennent techniquement :
        </p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          <li><strong>Vercel</strong> — hébergement de l'application</li>
          <li><strong>Prisma</strong> — hébergement de la base de données</li>
          <li><strong>Resend</strong> — envoi des emails de confirmation et de réinitialisation</li>
          <li>
            <strong>GoCardless</strong> — lecture de vos comptes auprès de votre banque, uniquement
            si vous activez la synchronisation bancaire
          </li>
        </ul>
        <p style={paragraphe}>
          Transferts hors Union européenne :{" "}
          <ACompleter>à documenter selon les régions retenues</ACompleter>
        </p>
      </Section>

      <Section titre="Vos droits">
        <p style={paragraphe}>
          <strong>Emporter vos données</strong> — l'onglet Foyer permet de télécharger l'intégralité
          du foyer dans un fichier lisible.
        </p>
        <p style={paragraphe}>
          <strong>Tout effacer</strong> — le même onglet permet de supprimer le compte. La
          suppression emporte le foyer entier et ne peut pas être annulée.
        </p>
        <p style={paragraphe}>
          <strong>Rectifier</strong> — toutes les données se modifient directement dans
          l'application.
        </p>
        <p style={paragraphe}>
          Pour toute question ou réclamation :{" "}
          <ACompleter>adresse de contact</ACompleter>. Vous pouvez également saisir la CNIL.
        </p>
      </Section>

      <Section titre="Cookies">
        <p style={paragraphe}>
          Un seul cookie est déposé, et uniquement une fois connecté : celui qui maintient la
          session. Il est strictement nécessaire au fonctionnement du service, ne suit personne et
          ne sert à aucune mesure d'audience — c'est pourquoi aucun bandeau de consentement ne vous
          est présenté.
        </p>
      </Section>
    </Cadre>
  );
}
