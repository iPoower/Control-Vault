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
5. **Objectif 0 € par mois.** Privilégier les offres gratuites et le stockage déjà disponible ; vérifier les quotas et conditions avant chaque activation. Ne jamais réduire la sécurité ou supprimer des sources pour respecter le budget. Aucun service ni compte payant n’est créé par cette PR.

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

Les vues lisent le store et utilisent les parcours. Brancher un service réel exige aussi un moteur de transport opaque distinct, les barrières d’origine et de confidentialité, la récupération durable et une recette : remplacer simplement DemoDrive exposerait le chemin d’import JSON en clair.

## Pile technique

| Choix | Pourquoi |
|---|---|
| TypeScript sans framework | Build statique compact ; consommation mémoire mobile à mesurer |
| Vite | Build statique pour GitHub Pages, chemins relatifs (`base: './'`) |
| Web Crypto | AES-256-GCM, PBKDF2, SHA-256 natifs ; clés non exportables |
| `<dialog>` natif | Focus piégé, Échap et fond inerte ; contrôles axe et clavier complétés par une recette physique |
| Instrument Sans (auto-hébergée) | Aucun appel à Google Fonts : compatible CSP stricte et hors ligne |
| Vitest + Playwright + axe-core | Tests unitaires du cœur, parcours sur Chromium et WebKit, WCAG 2.2 AA |

## Format de sauvegarde `.cvault`

```
"CVLT" | version (1) | sel (16 o) | IV (12 o) | AES-256-GCM(JSON) + tag (16 o)
```

- Le JSON contient `app` et `schema` : une version n'est restaurable que dans la bonne application, avec un format connu.
- Le sel du v1 est inutilisé avec la clé de session ; il n’est pas authentifié comme AAD. Modifier ce sel change le hash mais peut laisser le déchiffrement réussir. Ce comportement est testé et documenté, sans changement du format v1.
- GCM authentifie le chiffré/tag avec l’IV. SHA-256 du fichier détecte une divergence avec une référence fiable ; il ne prouve ni l’auteur, ni l’exhaustivité, ni l’absence de rejeu.
- Le v1 n’est pas un format durable activable. Toute nouvelle enveloppe authentifie ses métadonnées dans une version explicitement revue.

## Parcours de sauvegarde

| Étape | Ce qui est réellement fait | Échec → |
|---|---|---|
| Préparation | Validation JSON bornée, puis sérialisation et comptage | Rien écrit |
| Vérification | Schéma de démo complet, révision, collections et identifiants ; maximum 10 Mio UTF-8, profondeur 32 et 100 000 nœuds | Rien écrit |
| Chiffrement | AES-256-GCM, empreinte du fichier chiffré | Rien écrit |
| Envoi | Upload avec progression mesurée ; le fournisseur de démo ne publie qu'un fichier complet | Aucun succès confirmé ; un fichier peut rester après l'envoi |
| Contrôle distant | Empreinte fournisseur puis octets retéléchargés comparés à l'empreinte locale | Aucun succès confirmé |
| Confirmation | Version enregistrée, événement journalisé | — |

## Parcours de restauration

1. **Aperçu** (sans rien modifier) : téléchargement, contrôle d'empreinte, déchiffrement, différences par collection, alerte si une collection critique (débriefs de trajet, sessions de travail) perd des éléments.
2. **Confirmation explicite** : case à cocher nommant la date de la version.
3. **Copie de sécurité** de l'état actuel, vérifiée. Sans elle, on s'arrête.
4. Téléchargement → empreinte → déchiffrement → validation.
5. **Remplacement atomique de la copie fictive** : l'état n'est remplacé qu'à la fin, si son identité et son contenu correspondent encore au reçu d’aperçu, consommé une seule fois. En cas de conflit, l'état concurrent est conservé. Un retour arrière n'annule que notre propre publication, jamais les ajouts d'une autre opération.

## Calcul de l'état global (`src/core/status.ts`)

Fonction pure, testée. Niveaux : `ok`, `attention`, `action`, `unknown`.

- Hors ligne → `unknown` : on ne prétend rien sur Drive ni Supabase.
- Session expirée, échec non résolu, application jamais sauvegardée → `action`.
- Sauvegarde plus ancienne que le délai de fraîcheur, Supabase injoignable, file d'attente → `attention`.
- « Tout est vérifié » seulement si toutes les sources sont joignables et toutes les applications ont une version récente vérifiée.

## Phases suivantes — aucune activation

Le plan A–F et ses critères de sortie figurent dans [AUDIT_PR6_2026-10-19.md](AUDIT_PR6_2026-10-19.md) : conservation, origine isolée, OAuth minimal, transport chiffré, index facultatif puis recette. La numérotation historique Phase 2/3 des branches et de l’étude cryptographique ne vaut pas autorisation de connexion.

La démo ne persiste que ses préférences d’affichage. Les fichiers, les clés, les reçus d’aperçu et l’historique sont volatils. Les versions fictives initiales sont relues depuis le fournisseur mémoire et leur SHA-256 recalculé avant `verifiedAt` ; leur date de création et leurs anciens événements sont des fixtures de scénario. La date de preuve est réelle. La fraîcheur dépend de la création de la sauvegarde, jamais d’une simple relecture récente.

Le contrôle global et la sélection dans l’explorateur emploient le même moteur de relecture. Les résultats sont publiés par version, liés à son identité et son hash ; une interruption ne rétablit pas une preuve invalidée. Aucun fichier non confirmé n’est supprimé automatiquement.

## Analyse adverse (pre-mortem)

| Risque | Impact | Parade |
|---|---|---|
| **Origine partagée** : `ipoower.github.io` héberge aussi Race Control ; stockage local commun | Une page compromise lirait les données de l'autre | Cloudflare Pages dédié, publié uniquement par le pipeline ([DEPLOYMENT.md](DEPLOYMENT.md)) ; GitHub Pages reste en démonstration |
| Publication d'un commit non vérifié | Code non testé en production | Pipeline unique : `needs: verify`, artefact du même run, SHA contrôlé en ligne, environnement `production` approuvé |
| Index distant indisponible ou offre gratuite suspendue | Catalogue indisponible | Récupération à partir des fichiers et métadonnées minimales ; index facultatif |
| Quota du fournisseur réduit ou atteint | Envoi refusé | Le quota actuel de la démo est fictif ; le futur fournisseur devra interroger le quota réel, sans purge d’historique |
| Navigateur/OS purge le stockage ou arrête la page | Perte de mémoire ou de données locales | Ne pas traiter le stockage navigateur ni l’installation PWA comme une sauvegarde indépendante |
| GitHub Pages ne permet pas d'en-têtes HTTP | Pas de `frame-ancestors` | Démonstration seulement ; la production Cloudflare envoie CSP, `X-Frame-Options`, HSTS via `_headers` |
| Phrase secrète oubliée | Sauvegardes illisibles | Phrase de récupération papier, test de restauration guidé |
