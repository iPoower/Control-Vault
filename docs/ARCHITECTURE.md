# Architecture — Control Vault

## Portée actuelle et intégration Race Control

Le moteur décrit ci-dessous est un **prototype de démonstration en mémoire**.
Son payload fictif `app: race-control, schema: 3` n'est ni le coffre interne v3
de Race Control ni un format de sauvegarde reconnu par cette application.
La clé `.cvault` disparaît avec la session : aucune durabilité réelle n'est démontrée.

Pour l'interopérabilité, [INTEGRATION.md](INTEGRATION.md) fait foi : Race Control
chiffre et authentifie son paquet ; Control Vault conserve les octets opaques,
ne demande pas le code Race Control et remet un fichier à son import vérifié.
Le format `.cvault`, les comptes de collections et la restauration de payload
ci-dessous restent réservés à la démo ; ils ne sont pas le futur chemin Race Control.
La matrice réelle et les dépendances avant activation sont dans
[ECOSYSTEM_RELIABILITY.md](ECOSYSTEM_RELIABILITY.md).

## Principes cibles avant toute activation réelle

1. **Les fichiers récupérables font foi.** Race Control conserve son paquet contractuel original ; `.cvault` reste le format propre à la démo et à l'étude générique. L'index éventuel ne doit jamais être nécessaire à la récupération. Le fournisseur en mémoire et la clé éphémère actuels ne satisfont pas cette durabilité.
2. **Rien n'est affirmé sans preuve.** L'état « vérifié » exige une empreinte SHA-256 identique avant envoi et après relecture côté Drive.
3. **Chiffrement sur l'appareil.** Un fournisseur réel ne doit recevoir que des fichiers déjà chiffrés. Le chemin JSON générique actuel est réservé au fournisseur de démonstration.
4. **Aucune écriture silencieuse.** Pas d'écrasement, pas de suppression automatique, pas d'écriture dans Race Control ou Reconversion Control sans contrat d'intégration validé.
5. **0 € par mois.** GitHub Pages, Drive existant, Supabase Free, aucune dépendance payante.

## Vue d'ensemble

```
┌──────────────────────── Navigateur (iPhone / PC) ────────────────────────┐
│                                                                          │
│  Vues (src/views)  ──►  Parcours (src/flows)  ──►  Moteurs (src/app.ts)  │
│   accueil, fichiers,     sauvegarde, restauration,   runBackup            │
│   applis, historique,    contrôle d'intégrité        runRestore           │
│   sécurité, réglages                                  verifyAll           │
│        ▲                                                  │               │
│        │ abonnement                                       ▼               │
│   Store (src/core/store)  ◄──────────────  Cœur pur (src/core)            │
│   état unique, synchrone                   status · crypto · diff ·       │
│                                            validate · format (testés)     │
│                                                  │                        │
│                                 Contrats (src/services/contracts.ts)      │
│                                  StorageProvider        Journal           │
└──────────────────────────────────┬─────────────────────────┬─────────────┘
                                   │                         │
            Phase 1 : DemoDrive (mémoire)        Phase 1 : DemoJournal
            Phase 2 : Google Drive API v3        Phase 4 : Supabase (tables vault_*)
                     OAuth GIS + Picker                     RLS auth.uid()
```

Les vues ne connaissent que le store et les parcours. Remplacer la démonstration par les vrais services consiste à fournir deux implémentations des contrats, sans toucher à l'interface.

## Pile technique

| Choix | Pourquoi |
|---|---|
| TypeScript sans framework | ~35 Ko gzip au total, mémoire minimale sur iPhone, aucune dépendance d'exécution à maintenir |
| Vite | Build statique pour GitHub Pages, chemins relatifs (`base: './'`) |
| Web Crypto | AES-256-GCM, PBKDF2, SHA-256 natifs ; clés non exportables |
| `<dialog>` natif | Focus piégé, Échap, fond inerte : accessibilité gratuite et fiable sur Safari |
| Instrument Sans (auto-hébergée) | Aucun appel à Google Fonts : compatible CSP stricte et hors ligne |
| Vitest + Playwright + axe-core | Tests unitaires du cœur, parcours sur Chromium et WebKit, WCAG 2.2 AA |

## Format de sauvegarde `.cvault`

```
"CVLT" | version (1) | sel (16 o) | IV (12 o) | AES-256-GCM(JSON) + tag (16 o)
```

- Le JSON contient `app` et `schema` : une version n'est restaurable que dans la bonne application, avec un format connu.
- Le sel est présent dès la v1 pour que la dérivation par phrase secrète (Phase 3) ne change pas le format.
- GCM authentifie le contenu : un seul octet modifié rend le déchiffrement impossible.

## Parcours de sauvegarde

| Étape | Ce qui est réellement fait | Échec → |
|---|---|---|
| Préparation | Sérialisation du payload, comptage par collection | Rien écrit |
| Vérification | Structure (`app`, `schema`), JSON valide | Rien écrit |
| Chiffrement | AES-256-GCM, empreinte du fichier chiffré | Rien écrit |
| Envoi | Upload avec progression mesurée ; le fournisseur de démo ne publie qu'un fichier complet | Aucun succès confirmé ; un fichier peut rester après l'envoi |
| Contrôle distant | Empreinte fournisseur puis octets retéléchargés comparés à l'empreinte locale | Aucun succès confirmé |
| Confirmation | Version enregistrée, événement journalisé | — |

## Parcours de restauration

1. **Aperçu** (sans rien modifier) : téléchargement, contrôle d'empreinte, déchiffrement, différences par collection, alerte si une collection critique (débriefs de trajet, sessions de travail) perd des éléments.
2. **Confirmation explicite** : case à cocher nommant la date de la version.
3. **Copie de sécurité** de l'état actuel, vérifiée. Sans elle, on s'arrête.
4. Téléchargement → empreinte → déchiffrement → validation.
5. **Remplacement atomique de la copie fictive** : l'état n'est remplacé qu'à la fin, s'il n'a pas changé pendant l'opération. En cas de conflit, l'état concurrent est conservé. Un retour arrière n'annule que notre propre publication, jamais les ajouts d'une autre opération.

## Calcul de l'état global (`src/core/status.ts`)

Fonction pure, testée. Niveaux : `ok`, `attention`, `action`, `unknown`.

- Hors ligne → `unknown` : on ne prétend rien sur Drive ni Supabase.
- Session expirée, échec non résolu, application jamais sauvegardée → `action`.
- Sauvegarde plus ancienne que le délai de fraîcheur, Supabase injoignable, file d'attente → `attention`.
- « Tout est vérifié » seulement si toutes les sources sont joignables et toutes les applications ont une version récente vérifiée.

## Phases suivantes

| Phase | Contenu | Points d'attention |
|---|---|---|
| 2 | Google Identity Services (jeton en mémoire), Drive API v3, Google Picker : l'utilisateur choisit lui-même ses dossiers (aucun identifiant dans le code) | `drive.file` ne voit pas les fichiers créés hors de l'app : le Picker est obligatoire |
| 3 | Phrase secrète → Argon2id (étude : [CRYPTO.md](CRYPTO.md)), clé de récupération, imports, restaurations réelles | Perte de la phrase = sauvegardes illisibles, par conception |
| 4 | Tables `vault_versions`, `vault_events` dans `reconversion-control`, RLS `owner = auth.uid()` | Ne jamais toucher `reconversion_progress` ; projet Free mis en pause après 7 jours d'inactivité |
| 5 | Contrat Race Control versionné, chiffrement GCM/AAD par Race Control, transport opaque et import manuel ; Reconversion Control ultérieur | SHA-256 n'est pas une signature ; aucune suppression de sources |
| 6 | Durcissement, mesures de performance, déploiement final | — |

## Analyse adverse (pre-mortem)

| Risque | Impact | Parade |
|---|---|---|
| **Origine partagée** : `ipoower.github.io` héberge aussi Race Control ; stockage local commun | Une page compromise lirait les données de l'autre | Cloudflare Pages dédié, publié uniquement par le pipeline ([DEPLOYMENT.md](DEPLOYMENT.md)) ; GitHub Pages reste en démonstration |
| Publication d'un commit non vérifié | Code non testé en production | Pipeline unique : `needs: verify`, artefact du même run, SHA contrôlé en ligne, environnement `production` approuvé |
| Pause Supabase Free (7 jours sans activité) | Journal distant indisponible | Drive reste la vérité ; l'interface le signale sans bloquer |
| Quota 5 To lié à une offre étudiante | Envois refusés si le quota retombe à 15 Go | Quota lu depuis l'API, jamais codé en dur ; alerte au-delà de 80 % |
| Safari efface le stockage d'un site non installé après 7 jours sans visite | Perte des réglages locaux | Rien de critique n'est stocké localement ; installation PWA recommandée |
| GitHub Pages ne permet pas d'en-têtes HTTP | Pas de `frame-ancestors` | Démonstration seulement ; la production Cloudflare envoie CSP, `X-Frame-Options`, HSTS via `_headers` |
| Phrase secrète oubliée | Sauvegardes illisibles | Phrase de récupération papier, test de restauration guidé |
