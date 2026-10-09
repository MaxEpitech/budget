# Budget du foyer

Application de budget familial : dépenses et revenus récurrents ou ponctuels,
crédits amortissables, enveloppes projet, supports d'épargne avec projection, et
répartition des charges communes entre les membres du foyer.

Front React (Vite), API Express, base Postgres via Prisma. Un compte = un foyer.

## Prérequis

- Node 22 ou plus — le lanceur de tests s'appuie sur des options apparues après
  Node 20, dont le support a pris fin en avril 2026
- Une base Postgres (Neon, Prisma Postgres, ou un Postgres local)

## Installation

```bash
npm install                        # installe client et serveur, génère le client Prisma
cp .env.example .env               # puis renseigner DATABASE_URL
npx prisma migrate dev             # crée les tables
npx prisma db seed                 # facultatif : jeu de démonstration
npm run dev                        # démarre le client et l'API
```

Le seed **refuse de s'exécuter si la base contient déjà des données** — il les
effacerait toutes. Pour passer outre volontairement, après sauvegarde :
`FORCE_SEED=1 npx prisma db seed`.

Il crée un compte de démonstration : `demo@budget.local` / `budget-demonstration`.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Client et API ensemble ; les ports occupés sont contournés automatiquement |
| `npm test` | Tests du serveur, puis vérification des types et tests du client. Les tests d'intégration sont ignorés faute de `DATABASE_URL_TEST` |
| `npm run sauvegarder` | Export JSON complet de la base dans `sauvegardes/` (ignoré par Git) |
| `npm run restaurer -- <fichier> [--essai]` | Recharge un export ; `--essai` le rejoue puis annule tout |
| `npm run rattacher -- mon@adresse.fr` | Rattache un compte à un foyer contenant déjà des données |

`rattacher` sert à la reprise : à l'inscription, chaque compte reçoit un foyer
neuf et vide. Si des données existaient avant les comptes, ce script désigne leur
propriétaire et supprime le foyer vide libéré. Il refuse d'agir si le foyer visé
appartient déjà à quelqu'un, si plusieurs foyers sont candidats, ou si le compte
abandonnerait des données au passage.

## Sauvegardes

[`.github/workflows/sauvegarde.yml`](.github/workflows/sauvegarde.yml) exporte la
base chaque nuit et dépose le fichier en pièce jointe du workflow — hors de la
base, car une sauvegarde rangée dans ce qu'elle sauvegarde ne protège de rien.
Il se déclenche aussi à la main. **Réglage à faire une fois** : ajouter
`DATABASE_URL` aux secrets du dépôt.

Une sauvegarde jamais restaurée n'est pas une sauvegarde, c'est une hypothèse.
`npm run restaurer -- <fichier> --essai` lève le doute sans risque : la
restauration est réellement rejouée, les effectifs sont comparés à l'export,
puis tout est annulé et la base ressort intacte. Sans `--essai`, le script
refuse d'écrire dans une base déjà peuplée.

## Configuration

Tout est dans `.env`, décrit dans `.env.example`. Les deux réglages qui changent
le comportement :

- **`CONFIRMATION_EMAIL_REQUISE`** — à `0` (défaut), l'inscription ouvre la
  session immédiatement, sans email. À `1`, l'adresse doit être confirmée avant
  toute connexion. Le circuit complet est en place dans les deux cas.
- **`RESEND_API_KEY`** — sans clé, les emails ne partent pas : leur contenu et
  leur lien s'affichent dans le journal du serveur, ce qui suffit à essayer tout
  le parcours en local. Avec une clé ([resend.com](https://resend.com)), ils sont
  réellement envoyés.

## Capacité d'emprunt et synchronisation bancaire

L'onglet **Emprunt** estime ce que le foyer peut emprunter et acheter. Le calcul
vit dans `client/src/moteur/moteurFinancier.ts` — des fonctions pures, testées
sans navigateur — et le hook `useFinanceEngine` n'en est que la mémoïsation :
chaque frappe met tous les chiffres à jour, sans appel réseau. Trois étapes
s'enchaînent : le crédit à la consommation tel qu'il sera au mois cible,
remboursements anticipés compris ; l'endettement vu par la banque (35 % des
revenus retenus, loyers décotés) ; puis le capital empruntable sur 20 et 25 ans
et le prix du bien, apport et frais annexes compris.

Ce module est le seul écrit en TypeScript. Vite le lit tel quel ; `tsc` ne sert
qu'à vérifier les types, au début de `npm test`.

Revenus et charges se saisissent à la main, ou se lisent sur le compte bancaire
par l'intermédiaire d'un prestataire agréé — facultatif : chacun peut le
refuser, et un foyer sans prestataire ne voit simplement pas la bascule.

Deux prestataires sont pris en charge, un seul à la fois par foyer :

- **Enable Banking** — ouvert aux particuliers pour leurs propres comptes, en
  mode « restreint » : seuls les comptes liés à l'application dans son panneau
  sont lisibles. Le foyer fournit l'identifiant de son application et sa clé
  privée (fichier `.pem`), qui signe chaque requête ;
- **GoCardless Bank Account Data** — n'accepte plus de nouvelles inscriptions ;
  gardé pour qui y a déjà un compte (`Secret ID` et `Secret key`).

Un propriétaire les saisit dans l'onglet Foyer. Ils sont essayés auprès du
prestataire avant d'être gardés, puis le secret est chiffré en base
(AES-256-GCM) avec `CLE_CHIFFREMENT`, qui ne vit que sur l'hébergeur : une copie
de la base ne suffit pas à le relire. Il n'est plus jamais affiché. À défaut
d'identifiants propres au foyer, ceux de l'installation servent s'il y en a
(`GOCARDLESS_SECRET_ID` / `GOCARDLESS_SECRET_KEY`).

Pour Enable Banking, l'adresse de retour `<APP_URL>/banque/retour` doit être
déclarée dans l'application (« redirect URLs ») ; l'écran de réglage l'affiche,
et prévient si elle manque. `APP_URL` doit donc porter l'adresse publique
définitive.

Changer ou retirer les identifiants d'un foyer défait les banques reliées par
ses comptes : une liaison ouverte sous un compte, ou chez un prestataire, est
inutilisable depuis un autre. Changer `CLE_CHIFFREMENT` rend illisibles les
identifiants déjà enregistrés ; les foyers les ressaisissent.

### Import d'un relevé

Sans prestataire ni identifiants, un relevé téléchargé depuis l'espace bancaire
(CSV, OFX ou QIF) fait le même office, avec toutes les banques. Il sert à deux
endroits :

- **onglet Flux** — ses opérations sont affichées, puis celles que l'on retient
  entrent dans le flux comme lignes ponctuelles, à leur date, avec une catégorie
  proposée d'après le libellé. Les salaires sont décochés par défaut : ils sont
  déjà comptés dans les revenus des membres ;
- **onglet Emprunt** — il préremplit le revenu et les charges courantes, qui
  restent modifiables.

Avec des comptes séparés, on indique à qui est le compte du relevé. Dans le
flux, ses lignes sont attribuées à ce membre — des dépenses personnelles, qui
pèsent sur son reste et non sur les charges communes — et le titulaire entre
dans l'empreinte des opérations : le même abonnement prélevé le même jour chez
deux personnes donne bien deux lignes. Dans l'onglet Emprunt, chaque relevé
remplit le revenu de son titulaire, et les charges s'additionnent.

`POST /api/banque/releve` lit et analyse le fichier sans rien enregistrer ;
`POST /api/transactions/import` fait entrer les opérations validées, et
`DELETE /api/transactions/import/:lot` annule un import. Chaque opération porte
une empreinte (date, montant, libellé, rang), unique par foyer en base :
réimporter un relevé, ou un relevé qui le chevauche, n'ajoute rien en double.

Le CSV n'étant pas normalisé, `server/src/banque/releve.js` devine séparateur,
colonnes et écriture des montants ; le navigateur décode le fichier en UTF-8 ou,
à défaut, en Windows-1252. Un relevé PDF ou Excel est refusé avec un message qui
dit quoi télécharger à la place.

Les routes sont les mêmes quel que soit le prestataire : elles passent par une
façade commune (`server/src/banque/fournisseurs.js`). `/api/gocardless/*`,
l'ancien chemin, reste servi.

| Route | Rôle |
|---|---|
| `GET /api/banque/configuration` | Prestataire et origine des identifiants du foyer (jamais un secret) |
| `PUT /api/banque/configuration` | Propriétaire : vérifie puis enregistre `{ fournisseur, … }` |
| `DELETE /api/banque/configuration` | Propriétaire : retire les identifiants et les liaisons du foyer |
| `GET /api/banque/statut` | Où en est la liaison du compte connecté |
| `GET /api/banque/institutions` | Banques proposées (`?pays=FR`) |
| `POST /api/banque/initiate` | Ouvre le consentement, renvoie `{ link }` vers la banque |
| `GET /api/banque/callback` | Au retour de la banque (`code`, `state`) : confirme et retient le compte principal |
| `PUT /api/banque` | Bascule synchronisation / saisie manuelle, sans défaire la liaison |
| `GET /api/banque/financial-data` | Revenus et charges mensuels tirés des 90 derniers jours |
| `DELETE /api/banque` | Retire le consentement et efface la liaison |

Trois choix à connaître :

- **Aucune route ne prend d'identifiant de compte.** Le compte est celui de la
  session : il n'y a rien à falsifier pour lire les données d'un autre.
- **Aucune opération bancaire n'est stockée**, seulement les totaux de la
  dernière lecture. Ils sont resservis pendant six heures, les banques plafonnant
  les lectures par jour ; si la banque ne répond pas, ils le sont aussi, marqués
  `perime`.
- **L'analyse est volontairement simple** (`server/src/banque/analyse.js`) : est
  un revenu ce dont le libellé contient « salaire », « virement reçu », « paye »
  ou « paie » ; est une charge courante ce qui revient chez le même bénéficiaire
  sur au moins deux mois. Un ordre de grandeur à corriger, pas une comptabilité.

## Tests

Deux familles cohabitent. Les **tests unitaires** — formules financières,
hachage, gabarits d'emails — ne demandent rien et tournent toujours. Les **tests
d'intégration** parlent à l'API par le réseau et ont besoin d'une base : ils
couvrent le cloisonnement entre foyers, le parcours d'authentification et la
limitation de cadence.

Sans `DATABASE_URL_TEST`, ces derniers sont **ignorés** et `npm test` passe
quand même : on doit pouvoir travailler sans base sous la main. Avec, ils
créent leurs propres foyers sur des adresses en `.invalid` et les suppriment,
même quand un test échoue en cours de route.

Deux règles à connaître avant d'en écrire d'autres :

- **Les tests importent `test/aide/harnais.js`, jamais `src/` directement.** Le
  harnais substitue l'URL de la base avant de charger le serveur ; un import
  direct ferait tourner les tests sur la base de travail.
- **Les fichiers s'exécutent l'un après l'autre.** Ils partagent une base et des
  compteurs de cadence ; en parallèle, la purge de l'un remet à zéro ceux que
  l'autre est en train de compter.

## Intégration continue

[`.github/workflows/verification.yml`](.github/workflows/verification.yml) monte
un Postgres jetable, applique les migrations, lance les tests puis construit le
client — à chaque poussée et sur chaque pull request.

Il vérifie aussi que **la base migrée correspond exactement au schéma**. Une
modification du schéma sans sa migration passerait sans erreur au déploiement,
puis ferait réclamer au client des colonnes absentes : une panne qui
n'apparaîtrait qu'en production.

**Réglage à faire une fois, côté Vercel** : activer le blocage du déploiement
tant que les vérifications n'ont pas abouti. Sans lui, un commit rouge part en
production tout seul.

## Sécurité et exploitation

Les en-têtes de sécurité sont déclarés dans
[`vercel.json`](vercel.json) : politique de sécurité du contenu, HSTS,
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
`Permissions-Policy`.

Une limite à connaître avant de durcir la politique : l'interface utilise
abondamment les styles en ligne, hérités du prototype, donc `style-src` doit les
autoriser. Les scripts, eux, sont verrouillés strictement — c'est là que se
situe le vrai risque.

Chaque requête reçoit un identifiant, renvoyé dans l'en-tête `X-Request-Id` et
présent dans la réponse en cas d'erreur serveur : c'est lui qui permet de
retrouver la trace correspondante quand quelqu'un signale un incident. Les
journaux sont écrits en JSON sur la sortie standard, et **les champs sensibles y
sont masqués** — mot de passe, empreinte, jeton, cookie. C'est par les journaux
que ces valeurs fuitent le plus souvent.

`GET /api/ping` interroge la base et répond 503 si elle est injoignable : une
sonde qui ne peut pas échouer ne surveille rien.

## Déploiement sur Vercel

La même application Express sert de deux façons : un processus qui écoute un
port en développement (`server/src/index.js`), et une fonction sans état en
production (`api/index.js`). Les deux importent `server/src/app.js`.

`vercel.json` s'occupe du reste : construction du client dans `client/dist`,
acheminement de `/api/*` vers la fonction, et réécriture vers `index.html` pour
tout le reste — sans quoi les liens reçus par email (`/valider`,
`/reinitialiser`) tomberaient sur un 404.

La commande de build applique les migrations avant de construire le client :
`prisma migrate deploy && npm run build --workspace client`.

### Variables à créer sur Vercel

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | La base de production |
| `APP_URL` | Adresse publique, base des liens envoyés par email. À défaut, l'adresse du déploiement en cours est utilisée |
| `CONFIRMATION_EMAIL_REQUISE` | `0` ou `1`, voir plus haut |
| `RESEND_API_KEY` | Seulement si les emails doivent réellement partir |
| `CLE_CHIFFREMENT` | Pour que les foyers puissent enregistrer leurs identifiants bancaires depuis l'interface. Au moins 32 caractères, à ne jamais changer ensuite |
| `GOCARDLESS_SECRET_ID`, `GOCARDLESS_SECRET_KEY` | Facultatif : identifiants GoCardless communs aux foyers qui n'ont pas saisi les leurs |

**Ne pas définir `PORT` ni `PORT_CLIENT`** : ces variables ne servent qu'au
lanceur de développement et n'auraient là-bas que des effets parasites.

`NODE_ENV` est positionné à `production` par Vercel, ce qui fait passer le
cookie de session en `Secure`.

### Ce qui reste manuel

`npm run sauvegarder` et `npm run rattacher` sont des commandes locales : les
lancer depuis sa machine avec le `DATABASE_URL` de production dans `.env`.

## Structure

```
client/src/
  App.jsx            aiguillage : écrans d'authentification ou budget
  Budget.jsx         l'application, en-tête et onglets
  onglets/           Flux, Crédits, Emprunt, Projets, Épargne, Foyer
  moteur/            capacité d'emprunt : calcul pur et hook useFinanceEngine (TypeScript)
  ecrans/            connexion, inscription, confirmation, mot de passe oublié
  composants/        Champ, Carte, Jauge
  api.js             seul point de couplage avec le serveur
  finance.js         copie des formules pour l'affichage (le serveur fait foi)
  styles.css         CSS d'origine, inchangé

api/index.js         point d'entrée en production (fonction Vercel)

server/src/
  app.js             construction de l'application Express, sans écoute
  index.js           serveur de développement, met app.js à l'écoute d'un port
  routes/            etat, transactions, credits, projets, placements, membres, foyer, auth, banque
  banque/            clients Enable Banking et GoCardless, leur façade commune, chiffrement,
                     lecture des relevés importés, analyse des opérations
  auth/              mot de passe (scrypt), jetons, sessions, cadence, garde
  email/             transport et gabarits
  finance.js         formules financières — la référence
  conversion.js      frontière API : centimes en base, euros côté client
  foyerCourant.js    d'où vient le foyer d'une requête
server/prisma/       schéma, migrations, seed
server/scripts/      sauvegarde, rattachement d'un compte à un foyer
```

## Points à connaître

**Les montants sont stockés en centimes**, en entiers, pour éviter les erreurs de
virgule flottante. La conversion en euros se fait à la frontière de l'API
(`conversion.js`) ; le reste du code n'en sait rien.

**Les formules financières vivent dans `server/src/finance.js`** et sont couvertes
par des tests : mensualité et capital restant dû d'un crédit, projection
d'épargne avec ou sans plafond, quote-part d'un membre, reste à vivre, versement
requis sur un projet. Référence de contrôle : 14 000 € à 3,9 % sur 60 mois
donnent 257,20 €/mois et 1 432 € d'intérêts au total.

**Le cloisonnement passe par le foyer.** Toutes les tables métier portent un
`foyerId` ; les lectures le filtrent, et les écritures l'incluent dans leur
condition, si bien qu'un identifiant appartenant à un autre foyer se comporte
exactement comme un identifiant inexistant.

**Les secrets ne sont jamais stockés en clair** : mots de passe hachés avec
scrypt, jetons et identifiants de session réduits à leur empreinte SHA-256.

L'interface reprend le prototype mono-fichier d'origine (`budget-foyer.jsx`),
retiré du dépôt mais consultable dans l'historique Git.
