# Race Control ↔ Control Vault — contrat d’intégration V1

**Statut : proposition du lot 1, revue humaine obligatoire, aucune activation.**

Ce document est normatif et doit être strictement identique, octet pour octet,
dans les deux dépôts. Les mots DOIT, INTERDIT et REFUS désignent des exigences.
Le lot 1 ajoute uniquement ce contrat et des tests de contrat indépendants.
Il ne modifie ni l’export, ni l’import, ni le chiffrement, ni le stockage,
ni le comportement de production. Aucun OAuth, vrai Drive, déploiement,
échange direct entre applications ou changement de la branche Phase 2.

## 1. Responsabilités et limites de sécurité

Race Control est seul responsable de la collecte, de la sauvegarde exhaustive,
du chiffrement, des clés, du déchiffrement, de la décision d’importer et du
retour arrière. Control Vault transporte un paquet opaque déjà chiffré :
il ne demande jamais le code Race Control, ne possède aucune de ses clés,
n’appelle aucun déchiffrement et ne déduit aucun lieu, véhicule ou trajet.
Une vérification réussie dans Control Vault signifie seulement « structure
et empreinte cohérentes », jamais « données authentifiées ou restaurables ».

Les démos sous https://ipoower.github.io partagent actuellement une origine.
Les dossiers d’URL, préfixes de clés et préfixes de caches ne constituent pas
une isolation de sécurité complète : un script hostile de cette origine
pourrait menacer une session Race Control ouverte. La V1 INTERDIT tout
échange par localStorage, sessionStorage, IndexedDB, cookies, CacheStorage
ou service worker commun. Aucun accès Google réel depuis cette origine.
Les essais du présent projet utilisent exclusivement des données fictives.
Une origine Cloudflare dédiée, son API, ses en-têtes et ses protections
devront être vérifiés séparément avant toute Phase 2 réelle.

Les exemples, fixtures, noms de fichiers, URL, PR, commits et journaux ne
doivent contenir aucun secret réel, identifiant de dossier Drive ou donnée
personnelle. Les messages d’erreur restent génériques : jamais de contenu,
code, clé, chiffré complet, URL privée ou données déchiffrées dans les logs.

## 2. Blocages de conservation — NON RÉSOLUS par le lot 1

Le code actuel de Race Control présente trois risques distincts :

| Blocage | Comportement actuel | Exigence avant toute future activation |
|---|---|---|
| B01 | Plafond de 60 débriefs dans la sauvegarde/fusion et le journal | Aucune troncature, même après rechargement ; archive exhaustive ou refus explicite |
| B02 | Rétention de 90 jours du journal | Aucune suppression silencieuse des entrées anciennes ; archive exhaustive vérifiée |
| B03 | Une seule entrée retenue par clé de trajet, arbitrage entre plusieurs retours | Conserver toutes les versions/retours et les conflits sans écrasement |

Ces comportements sont documentés, pas corrigés ici. Leur suppression ne
doit pas être dissimulée dans les tests ou dans une modification de format.
L’activation des lots suivants reste BLOQUÉE tant qu’une stratégie exhaustive
n’est pas revue et prouvée. Une limite technique de fichier autorise un refus
explicite ; elle n’autorise jamais la suppression d’éléments pour « faire tenir ».

Avant toute migration ou restauration sensible, Race Control DOIT produire
et vérifier une sauvegarde récupérable de l’état courant, indépendante de
l’état en cours de remplacement. Sans cette preuve, REFUS sans écriture.
Le retour arrière technique existant ne remplace pas cette sauvegarde.
Une erreur, un quota insuffisant, un conflit d’onglets ou une interruption
ne doit ni effacer le journal précédent, ni annoncer un faux succès.
Un paquet ancien ne doit jamais faire disparaître un retour local plus récent.
Les caches recalculables sont distincts des données humaines à conserver.

## 3. Enveloppe externe et encodage

Un fichier contient exactement un objet JSON UTF-8, sans BOM, sans octets
UTF-8 invalides, sans commentaire, sans valeur non finie, sans doublon de
clé (y compris après décodage des échappements JSON), sans suffixe non JSON.
L’indentation, les espaces JSON et l’ordre des propriétés sont libres.
La profondeur maximale des objets/tableaux est 4, racine comprise.
Les propriétés supplémentaires sont INTERDITES à la racine et dans payload.
En particulier aucun nom de lieu, véhicule, trajet, adresse, identifiant
Drive, code, clé ou jeton ne peut être ajouté aux métadonnées en clair.

Les limites sont vérifiées AVANT analyse JSON, décodage Base64 et PBKDF2,
selon l’étape à laquelle elles sont connues. Un fichier surdimensionné est
refusé avant lecture/décodage ; une chaîne Base64 trop longue avant allocation
de ses octets ; les tailles effectives sont revérifiées après décodage.

<!-- integration-limits:start -->
~~~json
{
  "maxFileBytes": 71303168,
  "maxCipherBytes": 50331648,
  "maxJsonDepth": 4,
  "saltBytes": 16,
  "ivBytes": 12,
  "tagBytes": 16
}
~~~
<!-- integration-limits:end -->

Les limites sont respectivement 68 Mio de fichier UTF-8 et 48 Mio de chiffré
tag inclus. Une entrée supérieure à ces limites reste intacte et n’est pas
tronquée. Le nombre de caractères Base64 de c est au plus 67 108 864.
Une future archive segmentée exige un contrat distinct, pas une troncature.

Le schéma ci-dessous décrit la forme. Les contrôles sémantiques des sections
4 à 7 sont également obligatoires : le schéma seul n’authentifie rien.

<!-- integration-schema:start -->
~~~json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "race-control-backup schemaVersion 1",
  "type": "object",
  "additionalProperties": false,
  "required": ["format", "schemaVersion", "createdAt", "appVersion", "sha256", "payload"],
  "properties": {
    "format": { "const": "race-control-backup" },
    "schemaVersion": { "const": 1 },
    "createdAt": {
      "type": "string",
      "minLength": 24,
      "maxLength": 24,
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$"
    },
    "appVersion": { "type": "string", "minLength": 6, "maxLength": 14, "pattern": "^prod-[1-9][0-9]{0,8}(?![\\s\\S])" },
    "sha256": { "type": "string", "minLength": 64, "maxLength": 64, "pattern": "^[0-9a-f]{64}$" },
    "payload": {
      "type": "object",
      "additionalProperties": false,
      "required": ["alg", "kdf", "it", "s", "i", "c"],
      "properties": {
        "alg": { "const": "AES-256-GCM" },
        "kdf": { "const": "PBKDF2-SHA256" },
        "it": { "const": 600000 },
        "s": { "type": "string", "minLength": 24, "maxLength": 24, "pattern": "^[A-Za-z0-9+/]+={0,2}$" },
        "i": { "type": "string", "minLength": 16, "maxLength": 16, "pattern": "^[A-Za-z0-9+/]+={0,2}$" },
        "c": { "type": "string", "minLength": 24, "maxLength": 67108864, "pattern": "^[A-Za-z0-9+/]+={0,2}$" }
      }
    }
  }
}
~~~
<!-- integration-schema:end -->

createdAt DOIT être une date UTC réelle au format exact
YYYY-MM-DDTHH:mm:ss.sssZ : sa conversion en date puis en ISO doit restituer
la même chaîne. Les dates normalisées silencieusement sont refusées.
Le schéma n’inclut aucun nom de fichier, application tierce ou dossier Drive.
Les paramètres publics sel/IV/KDF servent uniquement à rendre le paquet
autonome ; ils ne révèlent aucune donnée métier.

## 4. Octets chiffrés, SHA-256 et authenticité

s, i et c utilisent le Base64 standard RFC 4648, AVEC padding requis,
sans espace ni retour ligne dans la chaîne, sans alphabet URL-safe.
Chaque chaîne doit être canonique : réencoder les octets décodés DOIT
reproduire exactement la chaîne d’entrée, y compris les bits de padding.
s contient exactement 16 octets et i exactement 12. c contient le chiffré
AES-256-GCM immédiatement suivi du tag de 128 bits (16 octets), soit de
16 à 50 331 648 octets. Sel et IV sont nouvellement aléatoires à chaque
export réel ; les octets fixes de tests ne sont jamais un modèle de génération.

Définition UNIQUE : C = décodage Base64 strict de payload.c.
sha256 = SHA-256(C), représenté par exactement 64 chiffres hexadécimaux
minuscules. Le hash inclut le tag GCM, sans le séparer de C.
Il ne porte NI sur le texte Base64, NI sur JSON.stringify(enveloppe),
NI sur un contenu déchiffré, NI sur s/i ou les autres métadonnées.
Changer l’indentation ou l’ordre JSON ne change donc pas l’empreinte.

Control Vault vérifie ce hash AVANT ajout puis SUR LES OCTETS RETÉLÉCHARGÉS,
pas seulement sur une empreinte annoncée par un fournisseur. Il conserve
également le hash attendu dans son catalogue de versions pour détecter un
remplacement du fichier et de son champ sha256 entre envoi et récupération.
Une discordance interdit l’ajout validé/la restauration. Race Control refait
le même calcul avant toute dérivation/déchiffrement ou écriture d’import.
Control Vault conserve le fichier original sans le réencoder ni le modifier.

SHA-256 est une vérification d’intégrité, PAS une preuve d’authenticité :
un attaquant pouvant modifier simultanément C, son champ sha256 et les
références de contrôle peut produire une empreinte cohérente. La réussite
du hash ne remplace JAMAIS la vérification authentifiée AES-GCM dans
Race Control, ni les validations métier et la garantie de conservation.
Control Vault ne peut pas vérifier lui-même l’authenticité AES-GCM.

Pour la NOUVELLE enveloppe seulement, les métadonnées sont aussi liées au
tag GCM par additionalData (AAD). AAD est l’UTF-8 du JSON compact du tableau
suivant, exactement dans cet ordre, sans BOM, espace ajouté ni saut de ligne :

~~~text
["race-control-backup",1,createdAt,appVersion,"AES-256-GCM","PBKDF2-SHA256",600000,s,i]
~~~

Les symboles createdAt, appVersion, s et i désignent les valeurs JSON réelles,
avec l’échappement JSON standard ; le tableau n’a ni clé ni valeur sha256.
Modifier une métadonnée, même avec le même hash de C, doit donc faire échouer
AES-GCM dans Race Control. C’est une exigence FUTURE soumise à revue du lot 2 :
aucun chiffrement n’est modifié dans le lot 1. L’ancien format conserve sa
vérification AES-GCM historique sans AAD, par un chemin séparé et explicite.

## 5. Versions et comparaison déterministe

schemaVersion est la version entière de ce protocole ; seule la valeur 1
est connue ici. Une valeur absente, de mauvais type ou différente est refusée
sans essai d’un schéma « proche » et sans repli vers un import historique.
format doit être exactement race-control-backup, sensible à la casse.

appVersion est la version PRODUCTRICE de Race Control, pas celle de Control
Vault, pas la version du schéma, pas un hash Git et pas la version du serveur
si un ancien shell PWA est encore chargé. Sa forme canonique est prod-N,
avec N entier de 1 à 999 999 999, sans zéro initial. Les valeurs sont comparées
NUMÉRIQUEMENT sur N (prod-10 > prod-9), jamais par ordre lexicographique.

Race Control doit connaître la version de son build effectivement chargé.
Si elle est absente ou invalide, REFUS de la nouvelle enveloppe. Si la version
productrice est supérieure à celle du lecteur chargé, REFUS avant import,
même quand schemaVersion est connu. Sinon, l’import reste conditionné à
AES-GCM, à la validité du contenu métier V1/V2 et à la conservation exhaustive.
Un downgrade des métadonnées ne doit pas contourner l’AAD authentifiée.
Control Vault ne compare pas prod-N à sa propre version : il peut transporter
un paquet de producteur futur si le schéma est connu, en indiquant que la
compatibilité avec le Race Control destinataire sera décidée par celui-ci.

| Fichier | Race Control actuel, avant lot 2 | Futur Race Control compatible | Futur Control Vault V1 |
|---|---|---|---|
| Historique twrc-backup V1 | Chemin historique conservé | Chemin historique conservé | Refus d’intégration versionnée, fichier intact, demander un réexport Race Control |
| Historique twrc-backup V2 | Chemin historique conservé | Chemin historique conservé | Même refus explicite ; aucun déchiffrement ni conversion automatique |
| Historique sans v/kdf/it, paramètres historiques valides | Chemin existant conservé | Chemin existant conservé, pas de version inventée | Même refus explicite |
| Nouveau schéma 1, producteur plus ancien ou égal au lecteur | Pas encore supporté | Vérifier hash + GCM/AAD + contenu + conservation, puis importer | Vérifier structure/hash et transporter opaque |
| Nouveau schéma 1, producteur plus récent que le lecteur | Pas encore supporté | Refus PRODUCER_TOO_NEW, aucun changement | Transport opaque possible, compatibilité non garantie |
| Schéma absent/inconnu, format inconnu ou version productrice mal formée | Aucun nouveau support ici | Refus explicite, aucun repli | Refus explicite |
| Hash incohérent, Base64 non canonique, JSON incomplet ou métadonnée interdite | Aucun nouveau support ici | Refus sans écriture | Refus sans ajout validé |

Les enveloppes historiques utilisent app=twrc-backup et v=1 ou 2 ;
certains fichiers omettent v/kdf/it. Les valeurs historiques par défaut sont
PBKDF2-SHA256 et 600000 itérations, jamais un coût arbitraire. Leur validation
et leur import restent ceux de Race Control, avec conservation locale.
Ces anciens fichiers n’ont pas appVersion : on ne l’invente pas pour les
faire passer dans le nouveau schéma. Le refus de Control Vault vise seulement
leur prise en charge par le nouveau contrat ; l’original reste importable
dans Race Control. Un paquet se déclarant du nouveau format n’est JAMAIS
traité comme historique après un échec. Les règles strictes de la nouvelle
enveloppe ne doivent pas durcir silencieusement le chemin historique :
les anciens fichiers conservent leur validateur et leur import existants.

## 6. Refus, prévalidation et limites de coût

Ordre de contrôle : taille de fichier → UTF-8/JSON/doublons/profondeur →
classification de format/version → forme stricte/date → Base64 et tailles →
SHA-256 → compatibilité du lecteur Race Control → GCM/AAD → contenu métier →
sauvegarde préalable vérifiée et plan sans perte → confirmation et import
vérifié avec retour arrière. Control Vault s’arrête après structure/hash ;
il n’exécute aucune des étapes privées de Race Control.

| Code de refus | Sens |
|---|---|
| FILE_TOO_LARGE | Limite de fichier dépassée avant analyse |
| MALFORMED_FILE | UTF-8, BOM, JSON, clés en double ou profondeur invalides |
| UNSUPPORTED_FORMAT | Mauvais format, aucun repli automatique |
| UNSUPPORTED_SCHEMA | Version de protocole inconnue/absente |
| INVALID_ENVELOPE | Propriété absente/en trop, mauvais type, date ou paramètre |
| INVALID_ENCODING | Base64 non canonique ou taille décodée invalide |
| INTEGRITY_MISMATCH | Hash de C différent du hash attendu |
| UNKNOWN_READER_VERSION | Version du build chargé inconnue/invalide |
| PRODUCER_TOO_NEW | Producteur plus récent que le lecteur Race Control |
| LEGACY_REEXPORT_REQUIRED | Fichier historique à importer/réexporter dans Race Control |
| AUTHENTICATION_FAILED | Mauvais code, GCM/AAD invalide ou contenu non authentifiable |
| CONSERVATION_BLOCKED | Sauvegarde préalable ou absence de perte non démontrée |

Toutes ces erreurs laissent l’original intact. Aucun refus ne démarre une
migration, un nettoyage de données, un fallback en clair ou un upload partiel
annoncé valide. En cas d’échec d’envoi, la version reste explicitement non
vérifiée ; elle ne peut être proposée comme restauration fiable.
Le coût KDF de la nouvelle enveloppe est exactement 600000 ; toute autre
valeur est refusée AVANT PBKDF2. Toute nouvelle suite cryptographique ou
modification de taille/format exige une nouvelle revue et une version adéquate.

## 7. Transport V1, historique et restauration

V1 utilise UNIQUEMENT des fichiers sélectionnés explicitement :
export Race Control → sauvegarde locale du fichier → ajout Control Vault →
vérification → dossier logique Race Control → nouvelle version immuable.
Dans ce lot et avant validation de Phase 2, « Drive » désigne uniquement
le fournisseur de démonstration. Aucun identifiant de dossier réel n’est
dans le contrat ou les fixtures. Une version antérieure n’est jamais
remplacée ni purgée automatiquement par l’ajout d’une nouvelle version.
Le catalogue ne contient que les métadonnées minimales de l’enveloppe,
les tailles/empreintes nécessaires et un identifiant technique opaque.

Restauration : sélection d’une version → téléchargement → vérification
contre son hash d’enveloppe ET son hash de référence enregistré → remise
du fichier intact → sélection dans Race Control → import vérifié de celui-ci.
Control Vault ne modifie aucun stockage de Race Control, n’ouvre pas son
coffre et n’annonce pas lui-même que Race Control est restauré.
La perte de la session Control Vault ne doit pas rendre le fichier chiffré
irrécupérable : aucune dépendance à une clé éphémère Control Vault.

Le parcours doit fonctionner dans Safari iPhone via Fichiers/partage ou
téléchargement et sélecteur de fichiers standard, sans API exclusive à
Chromium. Le partage annulé n’est pas un succès. Les essais WebKit émulent
un iPhone 11 Pro Max ; ils ne constituent pas une recette sur appareil réel.

V2 window.open/postMessage est HORS PÉRIMÈTRE, y compris sa préparation
exécutable. Elle exigera une validation humaine ultérieure, des origines
exactes en liste blanche, une fenêtre source vérifiée, une poignée de main
avec nonce, des limites/expirations et aucune donnée dans l’URL.

## 8. Tests du lot 1 et preuves futures obligatoires

Les deux dépôts possèdent des tests indépendants sans dépendance ni code
partagé entre applications. Ils lisent le schéma/les limites du présent
document et exercent des oracles de contrat UNIQUEMENT dans les tests.
Ces oracles ne sont pas importés par la production et ne prouvent pas une
implémentation de restauration. Les octets de fixtures sont synthétiques,
sans clé ni donnée personnelle ; leur hash correct ne signifie pas GCM valide.

Tests du lot 1 : forme valide ; champs obligatoires ; schéma/format inconnus ;
comparaison prod-9/prod-10 et refus de producteur futur ; lecteur inconnu ;
empreinte mal formée/différente ; hash des octets plutôt que du Base64/JSON ;
conservation de l’empreinte sous réindentation ; métadonnées interdites ;
UTF-8/JSON/BOM/doublons/profondeur ; paramètres KDF, Base64 et tailles ;
reconnaissance V1/V2 et historique sans version ; refus de conversion
automatique ; distinction entre validation de schéma et authenticité GCM.
Les bornes de taille sont aussi testées numériquement, sans allouer un fichier
de 68 Mio pour chaque cas. Race Control vérifie en plus ses validateurs
historiques existants sur des enveloppes fictives.

| Future preuve bloquante | Critère de succès, données fictives uniquement |
|---|---|
| F01 — plus de 60 trajets | Au moins 61 puis 120 trajets ; journal intégral identique après export, passage Vault, import, rechargement et déchiffrement |
| F02 — plus de 90 jours | Entrées de 91 et 365 jours présentes et identiques après le même parcours ; aucune purge |
| F03 — plusieurs retours du même trajet | Tous les retours et leurs versions conservés, y compris en conflit avec le journal local ; aucun arbitrage destructif |
| F04 — état local déjà enrichi | Sauvegarde récupérable préalable vérifiée, union sans perte ni écrasement ; échec = ancien état conservé |
| F05 — interruption et quota | Échecs à chaque étape, fermeture/réouverture et concurrence d’onglets ; restauration précédente récupérable, aucun faux succès |
| F06 — intégrité/authenticité | Chiffré altéré, hash recalculé par un attaquant, AAD modifiée et mauvais code refusés par Race Control sans écriture |
| F07 — compatibilité | Import réel V1/V2 conservé, schéma futur et producteur futur refusés, version du shell chargé faisant foi |
| F08 — historique et session Vault | Versions immuables, octets téléchargés identiques, vérification du hash de référence, fermeture Vault puis récupération toujours possible sans clé Vault |
| F09 — navigateurs | Chromium et WebKit iPhone 11 Pro Max, puis Safari sur iPhone physique ; résultats distingués dans le rapport |

F01 à F09 ne sont PAS validées par les seuls tests du lot 1. Les risques B01
à B03 restent ouverts. La future preuve compare le journal humain complet,
pas seulement une projection qui aurait déjà supprimé des entrées.

## 9. Séquencement, PR et arrêt

Préparation : lot 1 contrat/tests → lot 2 Race Control → lot 3 Control Vault
de démonstration → lot 4 parcours croisé. Le lecteur doit supporter le nouveau
paquet AVANT activation de son émetteur. L’ordre de fusion/activation des lots
2 et 3 devra donc être validé : soit le lecteur est fusionné d’abord et la PR
de l’émetteur attend, soit un mécanisme d’activation séparé reste désactivé.
Cette décision n’autorise aucune activation dans le lot 1.

Une PR par dépôt pour le présent lot, auto-fusion INTERDITE. Revue humaine
obligatoire même avec CI verte. Aucune modification/rebase/fusion de
feat/phase-2-google-drive, aucun workflow ou déploiement modifié, aucun
déploiement manuel. Les deux PR présentent leur SHA, leurs runs CI, l’égalité
des octets des contrats et la liste des blocages. Arrêt après leur création ;
aucune fusion et aucun lancement du lot 2 sans nouvelle validation.

La preuve d’identité est une comparaison binaire accompagnée du SHA-256
des deux fichiers docs/INTEGRATION.md et de leurs blobs Git. Une modification
ultérieure du contrat doit être synchronisée et revue dans les deux dépôts ;
elle ne peut activer un émetteur incompatible avec un lecteur publié.
