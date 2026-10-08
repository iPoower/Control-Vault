# Architecture — Control Vault

## Principes

1. **Drive est la source de vérité.** Chaque sauvegarde est un fichier `.cvault` autoportant dans le dossier Control Vault. Supabase n'est qu'un index et un journal : s'il disparaît, rien n'est perdu.
2. **Rien n'est affirmé sans preuve.** L'état « vérifié » exige une empreinte SHA-256 identique avant envoi et après relecture côté Drive.
3. **Chiffrement sur l'appareil.** Drive et Supabase ne voient jamais de données en clair.
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
| Envoi | Upload avec progression mesurée ; le fichier n'apparaît qu'une fois complet | Rien écrit, « Réessayer » |
| Contrôle distant | Empreinte Drive (`sha256Checksum`) comparée à l'empreinte locale | Version marquée non fiable |
| Confirmation | Version enregistrée, événement journalisé | — |

## Parcours de restauration

1. **Aperçu** (sans rien modifier) : téléchargement, contrôle d'empreinte, déchiffrement, différences par collection, alerte si une collection critique (débriefs de trajet, sessions de travail) perd des éléments.
2. **Confirmation explicite** : case à cocher nommant la date de la version.
3. **Copie de sécurité** de l'état actuel, vérifiée. Sans elle, on s'arrête.
4. Téléchargement → empreinte → déchiffrement → validation.
5. **Remplacement atomique** : l'ancien état n'est remplacé qu'à la toute fin. Tout échec restaure l'état d'origine.

## Calcul de l'état global (`src/core/status.ts`)

Fonction pure, testée. Niveaux : `ok`, `attention`, `action`, `unknown`.

- Hors ligne → `unknown` : on ne prétend rien sur Drive ni Supabase.
- Session expirée, échec non résolu, application jamais sauvegardée → `action`.
- Sauvegarde plus ancienne que le délai de fraîcheur, Supabase injoignable, file d'attente → `attention`.
- « Tout est vérifié » seulement si toutes les sources sont joignables et toutes les applications ont une version récente vérifiée.

## Phases suivantes

| Phase | Contenu | Points d'attention |
|---|---|---|
| 2 | Google Identity Services (jeton en mémoire), Drive API v3, Google Picker pour autoriser les 4 dossiers existants | `drive.file` ne voit pas les dossiers créés hors de l'app : le Picker est obligatoire |
| 3 | Phrase secrète → PBKDF2 (600 000 itérations), phrase de récupération, imports, restaurations réelles | Perte de la phrase = sauvegardes illisibles, par conception |
| 4 | Tables `vault_versions`, `vault_events` dans `reconversion-control`, RLS `owner = auth.uid()` | Ne jamais toucher `reconversion_progress` ; projet Free mis en pause après 7 jours d'inactivité |
| 5 | Contrats d'intégration Race Control / Reconversion Control (export JSON signé, import manuel) | Le journal des trajets ne doit jamais être perdu |
| 6 | Durcissement, mesures de performance, déploiement final | — |

## Analyse adverse (pre-mortem)

| Risque | Impact | Parade |
|---|---|---|
| **Origine partagée** : `ipoower.github.io` héberge aussi Race Control ; stockage local commun | Une page compromise lirait les données de l'autre | Avant la Phase 2 : adresse dédiée (Cloudflare Pages gratuit) ; jetons jamais en `localStorage` |
| Pause Supabase Free (7 jours sans activité) | Journal distant indisponible | Drive reste la vérité ; l'interface le signale sans bloquer |
| Quota 5 To lié à une offre étudiante | Envois refusés si le quota retombe à 15 Go | Quota lu depuis l'API, jamais codé en dur ; alerte au-delà de 80 % |
| Safari efface le stockage d'un site non installé après 7 jours sans visite | Perte des réglages locaux | Rien de critique n'est stocké localement ; installation PWA recommandée |
| GitHub Pages ne permet pas d'en-têtes HTTP | Pas de `frame-ancestors` | CSP en `<meta>` ; hébergement dédié corrigera |
| Phrase secrète oubliée | Sauvegardes illisibles | Phrase de récupération papier, test de restauration guidé |
