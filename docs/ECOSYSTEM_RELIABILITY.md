# Écosystème Control — état vérifié le 19 octobre 2026

Cette note décrit le code et les API GitHub observés, sans activation de données
réelles. Le [rapport PR6](AUDIT_PR6_2026-10-19.md) porte les résultats de recette.
CONFIRMÉ = source ou test identifié ; PROPOSÉ = travail futur ; NON VÉRIFIÉ =
preuve manquante. Aucun changement de Race Control n’est réalisé dans ce chantier.

## Références et portée

| Référence | Constat |
| --- | --- |
| Control Vault PR #6, point de départ | `84ddca81e8a2375ab50b46498efeee3843a845f7`, ouverte et en brouillon |
| Control Vault `main` | `07d6de09e60ff36061a9b45bc5bbc07ecdee68a2` |
| Branche corrigée exclusivement | `fix/ecosystem-backup-boundaries-20261016` |
| Race Control `main`, lecture seule | `ea66982c1583f8c7c873cb3b7bb8d2b0e6ea4bd1` |
| Race Control PR #176 | Fusionnée le 18 octobre ; tête `add85a7e95636edd7e49e375988326df9482dd13`, fusion `351454c8c8953f46fb900b24429852b06717d98e` |
| Recette physique Safari/PWA | NON VÉRIFIÉE dans cette mission |
| Hébergement Cloudflare et protections effectives d’environnement | NON VÉRIFIÉS ; aucune création ni publication |

La version du 16 octobre de cette note et les descriptions historiques de PR
sont périmées sur l’état de #176. Leurs mentions « brouillon » ne prévalent pas
sur l’état GitHub actuel. Inversement, fusionner #176 ne démontre ni l’activation
sur un profil personnel ni la réussite d’une restauration physique.

`docs/INTEGRATION.md` reste strictement inchangé et identique dans les deux
dépôts : 22 074 octets ; blob Git `3432a39de502416db3a5d4001efe4b5f684c466f` ;
SHA-256 `874da448f445d46e76a65dfb1c266b61effced3a2168ac125f77b9658cbdcc37`.
Son diagnostic historique B01–B03 doit être lu avec l’état de code ci-dessous.
Toute évolution normative exigera une revue inter-applications distincte.
Les 91 tests de contrat sont des oracles de spécification ; ils ne constituent
pas un moteur de transport ni une preuve de restauration réelle.

## B01, B02 et B03 : ce qui a réellement changé

| Sujet | Code actuel constaté | Risque ou prérequis restant | Test de non-perte requis |
| --- | --- | --- | --- |
| B01 — plafond de débriefs | `src/debrief.js` réserve 60 à l’affichage ; `JournalArchive` conserve les instantanés complets, y compris les sources non affichables. `Backup` transporte l’archive. | Le code ne reconstitue pas les entrées déjà supprimées par un ancien lecteur. Un ancien profil doit suivre la procédure de copie indépendante vérifiée avant activation. Quota et coût mémoire restent bornes physiques. | 61 puis 120 trajets : comparer les sources intégrales avant projection, après export/import et réouverture ; 60 lignes affichées peuvent correspondre à 120 sources conservées. |
| B02 — rétention du journal | L’archive cumulative n’utilise ni âge ni plafond métier. Annuler ajoute un état, sans supprimer les précédents. Les sources de 91/365 jours figurent dans les tests existants. | Cette garantie porte sur le journal archivé, pas sur toute donnée de l’application. Le stockage navigateur reste révocable par l’OS ; une copie antérieure n’inclut pas les futurs ajouts. | Simuler 400 jours supplémentaires ; préserver sources anciennes, annulations, champs inconnus et variantes de retours. Tester quota sans purge humaine. |
| B03 — versions concurrentes | Union idempotente des sources complètes ; réponses distinctes avec identifiant aléatoire ; relecture authentifiée sous Web Locks, contrôle des octets avant écriture et rollback limité à l’écriture encore possédée dans `SessionVault.writeVerified`. Le lecteur actuel accepte v2/v3 ; l’ancien refuse v3. | La protection dépend de l’activation et de lecteurs compatibles. Les anciens acteurs ignorants du protocole et les scripts de même origine restent hors frontière. Le chemin historique `DeviceStorage.recover` réapplique son instantané sans comparaison d’une révision : ne pas l’étendre à une restauration concurrente réelle sans chantier dédié. | Deux onglets, notifications retardées, ajout pendant WebCrypto, ancien lecteur en cache, import d’une version ancienne et panne de relecture : conserver toutes les variantes, les ajouts et le fichier courant. |

Preuves de code complémentaires : `src/journal-archive.js`, `src/backup.js`,
`src/session-vault.js`, `src/device-storage.js`, `src/config-import.js` et
`tests/test_journal_preservation.js`, `tests/test_session_vault.js`,
`tests/lib/journal-preservation-browser.js`. Les tests existants comprennent
120 trajets, 91/365 jours, union des versions, quota et contrôle de l’ancien
lecteur exact. Ils n’ont pas été relancés ni modifiés ici.

**B01/B02/B03 : protections présentes dans le code ; clôture de la garantie
opérationnelle non acquise.** L’activation individuelle, la recette physique,
l’exhaustivité du futur contenu contractuel et la récupération hors navigateur
restent à établir. Le document Race Control `docs/JOURNAL_PRESERVATION.md`
contient encore des statuts historiques : sa présence seule ne prouve pas une
recette actuelle.

Autre point de conservation à traiter séparément : `Backup.mergeWeather`
borne les rapports météo fusionnés par un `slice(-30)`. Si ces rapports incluent
des saisies humaines à conserver, la projection ne peut pas servir d’archive
exhaustive. Il faut inventorier ce périmètre avant de promettre « toutes les
données Race Control ». Aucun correctif Race Control n’est appliqué ici.

## Compatibilité effective

| Fichier | Race Control actuel | Control Vault corrigé |
| --- | --- | --- |
| Ancien export chiffré `twrc-backup` V1/V2 | Lecteur historique et union du journal dans le plan d’import | Refus explicite de l’import générique ; original conservé par l’utilisateur |
| Copie complète de récupération, en-tête v2/v3 | `readRecovery`, authentification puis plan vérifié ; ne pas réinstaller les clés/sessions du producteur | Refus explicite, sans conversion en `.cvault` |
| Futur `race-control-backup`, `schemaVersion:1` | Aucun émetteur/lecteur contractuel démontré | Aucun transport contractuel implémenté ; refus explicite |
| `.cvault` v1 de démonstration | Non supporté | Déchiffrable uniquement dans la session de démo avec sa clé éphémère |
| Payload fictif `app: race-control, schema:3` | Aucun lien avec le format métier RC | Schéma de démo complet, révision et collections contrôlés |
| Autre JSON générique | Hors contrat | Fichier de démo uniquement ; intégrité relue, aucune promesse d’import métier ou d’authenticité |

**Aucune chaîne réelle Race Control → Control Vault → Race Control n’est
actuellement démontrée.** Reconversion Control ne reçoit automatiquement ni le
format ni les clés de Race Control. Son adaptateur nécessite son propre contrat.

## Frontières de sécurité et de récupération

- Les deux chemins GitHub Pages partagent `ipoower.github.io`. CSP, préfixes et
  portées SW réduisent les accidents ; ils ne créent pas une isolation contre
  un script hostile de même origine. Aucune intégration par stockage commun,
  cookies, IndexedDB, SW ou postMessage n’est autorisée.
- Le SW corrigé de CV ne lit que son cache courant et son chemin d’application ;
  il ne purge que les anciens `cv-shell-`. Les caches étrangers sont préservés.
  Ce correctif ne transforme pas l’origine commune en frontière de confiance.
- CV actuel emploie uniquement `DemoDrive`/`DemoJournal`, en mémoire. Ses fichiers,
  sa clé et son historique disparaissent au rechargement. Seules les préférences
  d’affichage sont persistées. Aucun client Google/Supabase réel n’est branché.
- Un hash cohérent prouve une correspondance à une référence, pas l’auteur,
  l’exhaustivité ou la fraîcheur. Si fichier et référence sont remplacés ensemble,
  SHA-256 seul ne révèle pas l’attaque. Race Control doit vérifier GCM/AAD et son
  contenu complet ; un ancien paquet authentique reste soumis à l’aperçu.
- Drive n’est pas un stockage WORM : les droits d’écriture permettent des actions
  destructrices hors de l’application. Conserver une copie indépendante ; ne pas
  implémenter une purge automatique pour résoudre un quota.

## Chemin contractuel minimal — PROPOSÉ, non activé

1. Inventorier les sources complètes avant projection et leur import récupérable.
   Réutiliser les protections du journal sans considérer leur projection comme
   l’archive unique. Traiter séparément les autres données humaines plafonnées.
2. Livrer d’abord un lecteur RC compatible, avec version `prod-N` du code réellement
   chargé. Le `version.json` du serveur ne prouve pas la version d’une ancienne PWA.
   Une identité inconnue doit faire refuser le paquet futur.
3. RC produit le paquet contractuel : PBKDF2-SHA256 600 000, sel/IV neufs, GCM
   avec l’AAD exacte de `INTEGRATION.md`, SHA-256 de `c` incluant le tag. Copier
   `c/s/i` d’une récupération v3 ne fabrique pas une AAD valide.
4. CV valide les bornes, JSON strict, schéma, Base64 et hash de `c`, puis transporte
   les octets originaux opaques dans un fichier distinct. Il relit les octets
   conservés avant confirmation. Aucun code, clé ou déchiffrement RC dans CV.
5. RC reçoit le fichier intact, authentifie, compare, protège son état courant,
   demande confirmation et applique son plan vérifié avec détection de conflit.
   Le retour logiciel ne doit jamais être confondu avec la restauration d’une
   ancienne copie ne contenant pas les nouveaux ajouts.

Une phrase d’export robuste et sa récupération indépendante sont des décisions
RC à revoir ; PBKDF2 ne rend pas un code prévisible résistant aux attaques hors
ligne. Aucun changement silencieux de code, KDF, normalisation ou format existant.

Le plan A–F détaillé, les permissions Drive, l’index facultatif, le budget et les
critères d’arrêt figurent dans le rapport PR6. Toute activation exige une décision
séparée. La branche Phase 2 existante, Race Control et son infrastructure sont
laissés intacts.
