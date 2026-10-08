# Publication et protections — Control Vault

## Principe

**On publie exactement ce qui vient d'être vérifié, et seulement depuis `main`.**

```
PR ──► Vérification complète ──► Porte de publication (preuve, ne publie rien)

push main ──► Vérification complète ──┬─► GitHub Pages     (démonstration, sans Google)
              (build + tests + audit)  └─► Cloudflare Pages (production isolée, approbation humaine)
                     │
                     └─ artefact dist/ de CE commit (avec version.json = SHA)
```

| Garantie | Comment |
|---|---|
| Une vérification échouée bloque la publication | Les deux publications ont `needs: verify` : si `Vérification complète` échoue, elles sont ignorées |
| On publie le commit vérifié, rien d'autre | Les publications reprennent l'artefact `dist/` construit et testé dans le même run, sans reconstruire. `version.json` porte le SHA, et le pipeline vérifie en ligne que le site sert ce SHA |
| Pas de contournement manuel | Aucun `workflow_dispatch`. Publication uniquement sur `push` vers `main` |
| Pas de publication parallèle Cloudflare | Projet Cloudflare en **envoi direct** : il n'est relié à aucun dépôt Git et ne construit rien lui-même. Seul le pipeline peut publier, avec un jeton |
| Le jeton Cloudflare n'est accessible qu'à `main`, après approbation | Il est stocké dans l'environnement GitHub `production`, limité à `main`, avec toi comme relecteur obligatoire |
| Pas de prévisualisation publique des PR | Choix délibéré : une prévisualisation exigerait de confier le jeton à du code non fusionné. Les PR produisent des captures et un rapport en artefacts |

## Contrôles de « Vérification complète »

1. `npm ci`, avec les versions verrouillées.
2. `npm audit --omit=dev --audit-level=high`.
3. TypeScript.
4. Tests unitaires : état, chiffrement, différences, validation, contrôle de sécurité.
5. Build de production.
6. `scripts/security-check.ts` : secrets, source maps, liens de dossiers Drive, identifiants OAuth, CSP de la page, en-têtes `_headers`.
7. Parcours, sécurité et accessibilité WCAG 2.2 AA sur **Chromium et WebKit**, en mobile et en bureau.

---

## À faire de ton côté (l'API de cette session ne peut pas écrire ces réglages)

### 1. Protéger `main` — Settings › Rules › Rulesets › New branch ruleset

| Champ | Valeur |
|---|---|
| Nom | `Protection de main` |
| Enforcement status | **Active** |
| Bypass list | **vide** (personne ne contourne, administrateurs compris) |
| Target branches | **Include default branch** |
| Restrict deletions | ✅ |
| Block force pushes | ✅ |
| Require a pull request before merging | ✅, approbations requises : **0** (voir la note ci-dessous), « Require conversation resolution » ✅ |
| Require status checks to pass | ✅, « Require branches to be up to date before merging » ✅, contrôle : **`Vérification complète`** |

> **Pourquoi 0 approbation.** Les PR sont créées avec ton compte, et GitHub interdit d'approuver sa propre PR : exiger une approbation te bloquerait. La revue humaine des changements sensibles passe donc par deux verrous réels :
> 1. **Fusion** : je ne fusionne jamais une PR sensible (voir `SECURITY.md`). C'est toi qui cliques sur « Merge ».
> 2. **Production** : chaque publication Cloudflare attend ton approbation dans l'environnement `production`.

Une fois le ruleset enregistré, dis-le-moi : je relis la configuration réelle avec l'API (lecture autorisée) et je te confirme ce qui est actif.

### 2. Environnement GitHub `production` — Settings › Environments › New environment

| Champ | Valeur |
|---|---|
| Nom | `production` |
| Required reviewers | **iPoower** (décoche « Prevent self-review », sinon tu ne pourrais pas approuver) |
| Deployment branches and tags | **Selected branches** → `main` |
| Secrets | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (voir l'étape 3) |

Vérifie aussi l'environnement `github-pages` : *Deployment branches* doit être limité à `main`.

### 3. Cloudflare (gratuit) — sans connexion Git

1. Crée un compte sur https://dash.cloudflare.com. **Ne crée pas** de projet « Connect to Git » : le pipeline crée lui-même le projet en envoi direct.
2. *My Profile › API Tokens › Create Token › Custom token* :
   - permission : **Account › Cloudflare Pages › Edit**, et rien d'autre ;
   - ressources : ton compte uniquement.
3. Colle ce jeton dans le secret `CLOUDFLARE_API_TOKEN` de l'environnement `production`. **Ne l'envoie jamais dans le chat.**
4. Copie l'*Account ID* (barre latérale de *Workers & Pages*) dans le secret `CLOUDFLARE_ACCOUNT_ID`.
5. Settings › Secrets and variables › Actions › **Variables** › `CLOUDFLARE_PROJECT` = `control-vault`. Si ce nom est déjà pris chez Cloudflare, choisis-en un autre : l'adresse réelle sera `https://<nom>.pages.dev`.

Au push suivant sur `main`, le job « Publication Cloudflare Pages » attend ton approbation, publie l'artefact vérifié, puis contrôle en ligne le SHA servi et les en-têtes de sécurité. Tant que `CLOUDFLARE_PROJECT` n'existe pas, ce job reste inactif.

## En-têtes de production (`public/_headers`)

CSP stricte avec `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy: same-origin`, `X-Robots-Tag: noindex`.

La Phase 2 devra élargir la CSP aux seuls domaines Google nécessaires et passer COOP à `same-origin-allow-popups` pour la fenêtre de connexion. Ce sera une PR sensible, soumise à revue humaine.

## GitHub Pages

`ipoower.github.io/Control-Vault/` reste une **démonstration**. Son build n'a aucun identifiant Google, et la Phase 2 refusera toute connexion réelle hors de l'origine Cloudflare dédiée. GitHub Pages ne permet pas d'en-têtes HTTP : la CSP y est portée par la balise `<meta>`.
