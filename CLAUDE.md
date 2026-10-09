# Règles de travail

## Économie de tokens — délégation aux agents

L'agent principal orchestre : il comprend la demande, découpe, délègue, puis vérifie et résume. Il ne fait lui-même que les actions triviales (1–2 appels d'outils, ex. lire un fichier connu, petite modif ciblée) où lancer un agent coûterait plus cher.

Toute autre action est déléguée via l'outil Agent, en fixant explicitement `model` et `effort` selon ce barème (autorisation explicite de choisir `effort`) :

| Type de tâche | subagent_type | model | effort |
|---|---|---|---|
| Recherche de fichiers / code, lecture, inventaire | Explore | haiku | low |
| Modif mécanique (renommage, formatage, ajout de champ, texte UI) | general-purpose | haiku | low |
| Implémentation standard (composant, route API, test unitaire) | general-purpose | sonnet | medium |
| Débogage, bug non évident, logique financière / calculs | general-purpose | sonnet | high |
| Architecture, plan multi-fichiers, schéma Prisma / migration | Plan | opus | high |
| Revue de code / sécurité critique | general-purpose | opus | high |

Règles :
- Commencer par le niveau le plus bas plausible ; remonter d'un cran (modèle ou effort) seulement si le résultat est insuffisant.
- Prompts d'agent courts et autonomes : objectif, fichiers concernés, contraintes, format de réponse attendu (« réponds en ≤ 10 lignes », « liste de chemins uniquement »).
- Demander aux agents un résultat condensé, jamais des dumps de fichiers.
- Lancer en parallèle (même message) les agents indépendants ; réutiliser un agent existant via SendMessage plutôt que d'en recréer un.
- Pas de re-vérification de ce qu'un agent a déjà validé, pas de docs/changelog non demandés.
- Réponses à l'utilisateur : brèves, en français.
