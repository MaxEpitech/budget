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
| `npm test` | Tests. Les tests d'intégration sont ignorés faute de `DATABASE_URL_TEST` |
| `npm run sauvegarder` | Export JSON complet de la base dans `sauvegardes/` (ignoré par Git) |
| `npm run rattacher -- mon@adresse.fr` | Rattache un compte à un foyer contenant déjà des données |

`rattacher` sert à la reprise : à l'inscription, chaque compte reçoit un foyer
neuf et vide. Si des données existaient avant les comptes, ce script désigne leur
propriétaire et supprime le foyer vide libéré. Il refuse d'agir si le foyer visé
appartient déjà à quelqu'un, si plusieurs foyers sont candidats, ou si le compte
abandonnerait des données au passage.

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
  onglets/           Flux, Crédits, Projets, Épargne, Foyer
  ecrans/            connexion, inscription, confirmation, mot de passe oublié
  composants/        Champ, Carte, Jauge
  api.js             seul point de couplage avec le serveur
  finance.js         copie des formules pour l'affichage (le serveur fait foi)
  styles.css         CSS d'origine, inchangé

api/index.js         point d'entrée en production (fonction Vercel)

server/src/
  app.js             construction de l'application Express, sans écoute
  index.js           serveur de développement, met app.js à l'écoute d'un port
  routes/            etat, transactions, credits, projets, placements, membres, foyer, auth
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
