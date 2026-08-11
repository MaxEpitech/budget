# Budget du foyer

Application de budget familial : dépenses et revenus récurrents ou ponctuels,
crédits amortissables, enveloppes projet, supports d'épargne avec projection, et
répartition des charges communes entre les membres du foyer.

Front React (Vite), API Express, base Postgres via Prisma. Un compte = un foyer.

## Prérequis

- Node 20 ou plus
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
| `npm test` | Tests unitaires des formules financières et des primitives d'authentification |
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

server/src/
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
