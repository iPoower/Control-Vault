# Écosystème Control — état et chemin minimal

Audit ciblé du 16 octobre 2026. **Aucune activation réelle, fusion, nouvelle
infrastructure ou modification du contrat n'est autorisée par ce document.**
Statuts : CONFIRMÉ = preuve source/API/HTTP ou reproduction fictive ; PROPOSÉ =
travail futur ; NON VÉRIFIÉ = preuve manquante ; BLOQUÉ = prérequis non satisfait.

## 1. Références auditées

| Référence | État confirmé |
| --- | --- |
| Race Control `main` | `77b2f5abf5a22e354a4e17406b1a4a80c4cda32a` |
| PR Race Control #176 | Brouillon non fusionné, `7942f2be47cd9f2a69bc5f3fecffe1859fb49e6c` |
| Control Vault `main` | `07d6de09e60ff36061a9b45bc5bbc07ecdee68a2` |
| Branche Phase 2 Google Drive | `749ced292478e5aaaeb7f18203dd55bc5c4b77ee`, non modifiée |
| Race Control servi en HTTP | `prod-124`, build `2448ad966b26`, source `bb078d1bba47add6edbaf2fcbc4a50bdb9390d4d` |
| Control Vault servi en HTTP | Démonstration `0.1.0`, SHA `07d6de09e60ff36061a9b45bc5bbc07ecdee68a2` |

Le contrat `docs/INTEGRATION.md` est identique octet pour octet sur les deux
`main` : 22 074 octets ; blob Git `3432a39de502416db3a5d4001efe4b5f684c466f` ;
SHA-256 `874da448f445d46e76a65dfb1c266b61effced3a2168ac125f77b9658cbdcc37`.
Il reste inchangé dans ce correctif. Les tests du contrat sont des oracles de
schéma, pas des preuves d'une implémentation de transport ou de restauration.
Race Control conserve son fonctionnement, son export local et son import sans
connexion à Control Vault. Une panne du coffre central ne devient jamais un
prérequis de déverrouillage ou d'utilisation quotidienne de Race Control.

CI existantes réutilisées, sans relance : [Race Control main](https://github.com/iPoower/iPoower/actions/runs/38862815328),
[PR176](https://github.com/iPoower/iPoower/actions/runs/38900588006),
[confidentialité PR176](https://github.com/iPoower/iPoower/actions/runs/38902814496),
[Control Vault main](https://github.com/iPoower/Control-Vault/actions/runs/38862185038).
Les publications Cloudflare de ce dernier run sont ignorées : aucun hébergement
Cloudflare réellement actif n'est établi par cette preuve.

Le [run DATEX planifié](https://github.com/iPoower/iPoower/actions/runs/38943275150)
est en échec à la normalisation du flux public. Il est distinct de la CI de
sauvegarde ; sa cause n'a pas été investiguée ni corrigée dans cette mission.

## 2. Matrice réelle de compatibilité

« Refus » ne signifie jamais suppression ou conversion du fichier original.

| Fichier | RC main / prod-124 | RC candidat #176 | Control Vault main | Prototype corrigé |
| --- | --- | --- | --- | --- |
| Export historique chiffré `app: twrc-backup`, V1/V2 ou paramètres historiques omis | Lecteur historique ; limites B01–B03 toujours présentes | Lecteur historique conservé ; archive et union proposées | JSON générique accepté, sans compatibilité RC démontrée | Refus explicite de l'intégration ; original à restaurer dans RC |
| Fichier complet de récupération #176, en-tête interne `v:2` | Import fichier non supporté par ce chemin | `readRecovery` puis import vérifié, prérequis de copie | JSON générique, sans validation RC | Refus explicite ; jamais conversion `.cvault` |
| Fichier complet de récupération #176, en-tête interne `v:3` | Ancien lecteur refuse v3 ; aucun déclassement sûr | Lecteur complet et archive ; activation non publiée | JSON générique, sans validation RC | Même refus explicite |
| Futur `format: race-control-backup`, `schemaVersion:1` | Aucun moteur d'import/export contractuel | Aucun moteur contractuel activé par #176 | JSON générique ; schéma/hash contractuels non vérifiés | Refus jusqu'à implémentation du contrat |
| `.cvault` binaire v1 de démonstration | Non supporté | Non supporté | Lisible avec la clé éphémère de la session de démo | Même format ; aucune durabilité intersession nouvelle |
| Payload fictif CV `app: race-control, schema:3` | Aucun lien avec le métier RC réel | Aucun lien avec le coffre interne v3 | Modèle fictif | Schéma de démo connu uniquement ; versions inconnues refusées |

**BLOQUÉ : aucune chaîne réelle Race Control → Control Vault → Race Control
n'est actuellement prouvée.** Le nom d'une application ou le nombre `3` ne
constituent pas un contrat. Reconversion Control n'est pas modifié et ne reçoit
pas automatiquement le schéma ou le chiffrement de Race Control. Son futur
adaptateur pourra réutiliser le transport opaque, avec un contrat applicatif
revu ; un payload Reconversion ne doit pas se déclarer `race-control-backup`.

## 3. Frontières et menaces concrètes

- **CONFIRMÉ : origine commune.** Les chemins GitHub Pages ont le même
  `location.origin`. Les préfixes de clés/caches, CSP et portées des SW réduisent
  les accidents mais ne protègent pas une session RC d'un script hostile de la
  même origine. Aucun partage de localStorage, IndexedDB, cookies, CacheStorage
  ou SW pour l'intégration. Transport par fichier seulement, sans postMessage.
- **CONFIRMÉ : pas de service cloud réel dans main Control Vault.** `DemoDrive`
  conserve des copies en mémoire ; seule la préférence d'affichage est écrite
  en localStorage. Clé, versions et fichiers de démo disparaissent au rechargement.
  Une réussite de démo ne prouve pas une conservation durable ni une reprise PWA.
- **CONFIRMÉ : propriété des caches à la suppression.** CV ne purge que
  `cv-shell-`; RC ne purge que ses caches `twrc-`. Ces règles ne créent pas une
  isolation. Le SW de CV utilise encore des recherches globales de cache et
  n'applique pas de filtre de chemin aux requêtes de même origine : ne pas
  étendre son usage à des ressources privées ou interapplicatives.
- **BLOQUÉ : données personnelles sur l'intégration réelle.** Proposition
  minimale à autoriser séparément : une seule origine dédiée pour le vrai
  Control Vault, en réutilisant le projet/pipeline prévu s'il est démontré
  existant. Vérifier l'origine exacte, CSP/en-têtes, portées SW et absence de
  stockage commun. Aucune création, publication ni connexion ici.
- **NON VÉRIFIÉ : iPhone physique.** Chromium/WebKit CI ne prouvent ni la
  réouverture Safari/PWA, ni leur stockage éventuellement distinct, ni les
  limites mémoire/quota, ni les interruptions réelles. Première recette :
  120 trajets fictifs, export/import, fermeture/réouverture, comparaison des
  sources brutes ; aucun nouveau benchmark 500/1 000 lancé ici.
  La limite actuelle d'import JSON de CV (10 Mio) ne vaut pas validation des
  limites du contrat (68 Mio de fichier, 48 Mio de chiffré/tag). Les copies en
  mémoire, Base64 et parse JSON imposent une mesure Safari avant activation ;
  augmenter une limite ne prouve pas la faisabilité sur l'appareil.

## 4. Défauts reproduits et préparation limitée à la démo

Les régressions ciblées utilisent les moteurs réels du prototype avec un
fournisseur mémoire contrôlé. Elles ne lisent aucun profil réel.

| Défaut démontré sur main | Correctif préparé |
| --- | --- |
| Sauvegarde déclarée vérifiée avec un hash fournisseur correct et un téléchargement altéré | Relecture effective puis SHA-256 avant confirmation |
| Import retournant une réussite malgré une empreinte différente | Refus, événement d'échec, aucune confirmation |
| Fichier lu avant contrôle de sa taille | Prévalidation extension/taille avant `File.text()` |
| Contrôle global ne testant pas le téléchargement et conservant un ancien `verifiedAt` après échec | Vérification des octets, statut révoqué pour chaque fichier non vérifié ; fichiers conservés |
| Restauration écrasant un état ajouté pendant le téléchargement, ou son échec rétablissant l'ancien état | Contrôle de l'état avant commit ; rollback limité à notre propre publication |
| Versions de démo inconnues acceptées et erreur JSON pouvant exposer un extrait | Schémas de démo explicites et messages sans extrait |
| Paquets RC acceptés par le chemin JSON générique sans vérification du contrat | Refus explicite jusqu'au support contractuel ; aucune conversion |

Ces corrections ne rendent pas le prototype zéro connaissance : sa démo
continue de chiffrer/déchiffrer ses propres payloads fictifs. Elles n'ajoutent
pas de persistance, de connecteur Drive, de format RC ou de clé de récupération.
Un fichier envoyé mais non vérifié peut rester chez le fournisseur : ne pas
le supprimer automatiquement ni le déclarer sauvegarde restaurable.

## 5. Chemin minimal de l'export contractuel — PROPOSÉ

1. **Préserver les sources avant projection.** Réutiliser la capture exhaustive
   et l'import vérifié du candidat #176, sous réserve de sa revue et de sa
   recette. Les plafonds/rétentions/fusions de main ne doivent pas alimenter un
   paquet faussement déclaré complet. La sauvegarde préalable externe reste
   récupérable après une interruption et les ajouts locaux sont conservés.
2. **Formaliser le contenu complet une seule fois dans le contrat existant.**
   Réutiliser le modèle complet de récupération lu par #176 et son adaptateur
   d'import ; préciser la distinction avec la projection métier historique V2.
   Ne pas promettre la conservation de champs inconnus si cet adaptateur ne
   sait pas les restaurer. Cet inventaire et sa règle de refus restent un
   prérequis : aucun nouveau schéma de contenu n'est activé ici.
3. **RC produit `race-control-backup`.** Capture/validation, puis chiffrement
   AES-256-GCM avec l'AAD exacte du contrat, PBKDF2-SHA256 à 600 000 itérations,
   sel/IV neufs, SHA-256 des octets `c` incluant le tag, puis export du fichier.
   Copier simplement `c/s/i` d'un fichier de récupération ne crée pas une AAD
   valide : cette conversion doit être réalisée par RC, jamais par CV.
4. **Version du lecteur réellement chargé.** RC embarque une identité `prod-N`
   immuable conforme au contrat. Aujourd'hui `TWRC_BUILD` identifie le shell,
   mais `prod-N` vient de `version.json` du serveur : ce dernier peut être plus
   récent que la PWA. Tant que cette dépendance n'est pas résolue, refuser avec
   `UNKNOWN_READER_VERSION`. Tout changement build/déploiement sera une revue
   séparée, sans modifier discrètement les workflows dans ce correctif.
5. **CV transporte sans lire le métier.** Sélection de fichier, bornes et JSON
   stricts, schéma/Base64, hash de `c`, conservation des octets originaux, nouveau
   fichier/version sans écrasement, retéléchargement et vérification du hash de
   référence. Aucun mot de passe RC, aucune DEK RC, aucun `.cvault` éphémère
   supplémentaire. Le catalogue n'expose aucun trajet, lieu ou véhicule.
6. **RC décide de la restauration.** CV remet le fichier intact ; RC vérifie
   hash, version, GCM/AAD, contenu complet et différences, protège l'état courant,
   demande confirmation humaine puis importe avec relecture/rollback. Une
   ancienne version ne supprime pas un retour local récent. Un ancien logiciel
   refuse le v3 ; revenir au logiciel ne restaure pas les anciennes données.

## 6. Clés, récupération, historique et cloud futur

**PROPOSÉ : phrase d'export robuste et indépendante des sessions de service.**
PBKDF2 ne rend pas un code prévisible résistant aux attaques hors ligne. Employer
une phrase générée aléatoirement, conservée hors dépôt et hors URL ; documenter
son traitement exact. Ne pas normaliser ni modifier silencieusement les codes
historiques. Séparer code/clé RC, chiffrement des sauvegardes et jeton d'accès
Drive. Aucun changement de KDF ou de format historique dans ce lot.

La perte de l'appareil ou de la session CV doit laisser une récupération possible
avec le fichier autoportant et la phrase d'export conservés séparément. CV ne
détient aucun secret permettant de déchiffrer RC. Si la phrase est perdue et
qu'aucun mécanisme de secours n'a été conçu/revu, la récupération n'est pas
garantie ; aucun « reset » serveur ne doit la simuler.

Un historique non destructif crée un fichier distinct par version ; aucune
purge automatique, même en cas de quota. Drive avec des droits d'écriture n'est
pas un stockage WORM : un tiers autorisé peut supprimer/remplacer un fichier.
Le hash de référence détecte un remplacement tant que sa référence est fiable ;
SHA-256 seul ne prouve pas l'authenticité si fichier et catalogue sont altérés.
RC vérifie toujours GCM/AAD et la conservation des sources. Un replay ancien
authentique doit rester visible dans l'aperçu, jamais s'imposer silencieusement.

Drive futur : proposer seulement `drive.file` et le sélecteur explicite des
fichiers/dossiers autorisés ; jeton en mémoire, aucun identifiant de dossier,
client secret ou jeton dans le dépôt, les journaux ou les URL. Ne pas autoriser
une sélection de dossier à être interprétée comme l'accès à tout son contenu
préexistant : les fichiers doivent être accessibles avec `drive.file` ou choisis
explicitement, sans élargissement automatique au Drive complet. Ne pas autoriser
le chemin JSON générique en clair à utiliser ce fournisseur réel. Le checksum
Drive, lorsqu'il existe, complète mais ne remplace pas le retéléchargement.
L'index facultatif reste reconstructible à partir des fichiers et métadonnées
minimales : Supabase indisponible ne doit ni bloquer ni rendre la récupération
impossible. Aucun compte, permission, schéma ou service Supabase n'est modifié.

Sources primaires consultées :
[permissions Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
[fichiers et empreintes](https://developers.google.com/workspace/drive/api/reference/rest/v3/files),
[téléchargement des octets](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

## 7. Pipeline, acceptation et arrêt

**CONFIRMÉ par API :** CV main exige une PR, le check « Vérification complète »,
une branche à jour et aucune réécriture/suppression ; le nombre d'approbations
GitHub exigé est **0**. La revue humaine sensible est donc une règle de
gouvernance à maintenir explicitement, pas une approbation indépendante imposée
par cette configuration. RC gh-pages interdit suppression/réécriture. Les détails
de la protection classique RC main sont **NON VÉRIFIÉS** : API refusée en 403 au
connecteur ; aucune protection n'a été contournée ou changée.

Les workflows existants séparent vérification et publication. CV ne publie que
sur push main, avec artefact du run vérifié ; RC publie par sa CI et tags `prod-N`.
Aucun workflow/en-tête/domaine n'est modifié. PR176 reste au SHA audité et en
brouillon. Aucune autre PR existante ni la branche Phase 2 n'est modifiée.

Ordre proposé, avec revue avant chaque activation : conservation RC prouvée →
lecteurs du contrat disponibles avant l'émetteur → export RC authentifié et
transport CV en démo → parcours croisé de 120 trajets → décision d'isolation et
recette réelle Safari/PWA → autorisation distincte de Drive personnel.

Acceptation du premier parcours croisé : sources brutes intégrales identiques
après déchiffrement, versions et entrées anciennes conservées, copie préalable
récupérable, corruption/mauvais code/versions futures refusés sans écriture,
interruption sans succès trompeur. Réutiliser les tests existants ; ajouter
seulement les vecteurs déterministes AAD/GCM et les régressions du nouveau chemin.
Aucune relance des 52 suites ou des six jobs RC déjà verts sans changement RC.

**Arrêt de cette préparation :** PR en brouillon, preuves ciblées et revue humaine.
Aucune activation des données personnelles, fusion ou publication n'est réalisée.
