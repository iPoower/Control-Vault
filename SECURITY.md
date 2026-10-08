# Politique de sécurité — Control Vault

**Données privées. Code public. Opérations vérifiées.**

## Engagements

- **Aucun secret ni identifiant personnel dans ce dépôt public.** Pas de jeton, de mot de passe, de clé privée, de secret OAuth, ni d'identifiant de dossier Google Drive. Un contrôle automatique (`scripts/security-check.ts`) bloque la publication si l'un d'eux apparaît dans le code, la documentation, les workflows ou le build.
- **Dossiers Drive choisis par l'utilisateur.** En mode connecté, chaque dossier ou fichier est sélectionné explicitement dans le sélecteur Google. Aucun dossier n'est codé en dur.
- **Permissions Google minimales** : `drive.file` uniquement. Jamais `drive` ni `drive.readonly`.
- **Jetons Google en mémoire uniquement.** Jamais dans `localStorage`, IndexedDB, l'URL, les journaux ou GitHub. Aucun jeton de rafraîchissement côté navigateur.
- **Chiffrement côté appareil** avant tout envoi. Aucune sauvegarde réelle et durable avant la validation de la Phase 3 (voir [docs/CRYPTO.md](docs/CRYPTO.md)).
- **Aucune écriture silencieuse** : pas d'écrasement, pas de suppression automatique.
- **Hébergement isolé** : la version connectée sera servie depuis une origine Cloudflare dédiée, avec en-têtes de sécurité. `ipoower.github.io` reste une démonstration sans accès Google.
- **Publication contrôlée** : seul l'artefact vérifié d'un commit de `main` peut être publié (voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

## Politique de fusion

| Type de changement | Fusion |
|---|---|
| Correctifs et évolutions non sensibles (interface, textes, tests, documentation hors sécurité) | Automatique, une fois **tous** les contrôles verts |
| **Sensible** : chiffrement et clés, OAuth et permissions Google, CSP et en-têtes, workflows et publication, contrôle de sécurité, configuration publique (`src/config.ts`), politique de sécurité | **Revue humaine explicite obligatoire.** Une CI verte ne la remplace pas. La PR est préparée et testée, puis c'est **toi** qui fusionnes |

Les chemins sensibles sont listés dans [.github/CODEOWNERS](.github/CODEOWNERS).

## Historique Git

Les identifiants de dossiers Drive présents en Phase 1 ont été retirés du code. **Ils restent visibles dans l'historique public** (commit `0a0ee13` et antérieurs). Les effacer exigerait de réécrire l'historique par un force-push, ce que la protection de `main` interdit.

Un identifiant de dossier ne donne aucun accès à lui seul. Vérifie simplement que ces dossiers sont en partage **« Restreint »** dans Google Drive.

## Signaler un problème

Ouvre un avis de sécurité privé (*Security › Report a vulnerability*) sur ce dépôt.
