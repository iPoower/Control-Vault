# Race Control ↔ Control Vault — addendum A1 au contrat V1 : profil de synchronisation

**Statut : proposition, revue humaine obligatoire, aucune activation.**

Ce document complète `docs/INTEGRATION.md` sans le modifier. Il doit être
strictement identique, octet pour octet, dans les deux dépôts. En cas de doute,
le contrat V1 prévaut. Aucun OAuth, Drive réel, origine ou écran n'est activé.

## 1. Problème résolu

Le contrat V1 dérive la clé de chaque paquet du code Race Control avec un sel
neuf. Une session Race Control mémorisée reprend sans saisie du code : elle ne
peut alors ni produire ni lire un paquet. Une synchronisation automatique est
donc impossible sans stocker le code, ce qui est INTERDIT.

## 2. Descripteur de clé de compte

Le premier appareil crée un descripteur public `race-control-sync-key`,
`schemaVersion` 1. Propriétés exactes : `format`, `schemaVersion`, `keyId`
(32 hexadécimaux minuscules aléatoires), `createdAt` (même format que V1),
`kdf` = `PBKDF2-SHA256`, `it` = 600000, `s` (16 octets, Base64 canonique),
`check` = `{ i, c }`. `check.c` est le chiffrement AES-256-GCM, avec tag de
128 bits, de l'UTF-8 `race-control-sync-key-check-v1` sous la clé
PBKDF2(code, s), IV `check.i` de 12 octets aléatoires et AAD égale à l'UTF-8 de :

~~~text
["race-control-sync-key",1,keyId,createdAt,"PBKDF2-SHA256",600000,s,check.i]
~~~

Le descripteur ne contient ni code, ni clé, ni donnée personnelle. Il est
borné à 2 048 octets, JSON strict (pas de BOM, de doublon, profondeur 2).
Toute forme invalide est refusée AVANT PBKDF2. Un mauvais code échoue au
contrôle GCM et n'est jamais mémorisé.

## 3. Profil de paquet

Un paquet du profil de synchronisation est un paquet V1 inchangé : même
enveloppe, même AAD, même SHA-256 de `c`, même PBKDF2-SHA256 600000. Seule
différence : `payload.s` est le sel `s` du descripteur au lieu d'un sel neuf.
L'IV de 12 octets reste aléatoire et neuf à chaque paquet. Par dérogation
limitée à ce profil, la phrase « Sel et IV sont nouvellement aléatoires à chaque
export réel » de V1 §4 s'applique à l'IV seulement. Les exports manuels V1
gardent un sel neuf. Au-delà de 2³² paquets pour un même `keyId`, un nouveau
descripteur est OBLIGATOIRE.

Compatibilité : tout lecteur V1 connaissant le code ouvre ces paquets ; Control
Vault les valide et les transporte sans aucun changement de son schéma.

## 4. Disponibilité de la clé dans Race Control

La clé PBKDF2(code, s) est dérivée lors d'une saisie du code, vérifiée par
`check`, puis conservée comme CryptoKey AES-GCM **non extractible** dans
l'IndexedDB de l'origine Race Control. Sa durée est celle de la session
authentifiée qui a reçu le code, sept jours au plus ; elle est liée à cette
session (« appareil » ou onglet). Verrouiller, expirer, changer de descripteur
ou échouer au contrôle `check` l'efface. La reprise relit `check` avec la clé
conservée avant tout usage.

Un paquet dont `payload.s` diffère du descripteur connu, ou l'absence de clé
valide, produit le refus interne Race Control `CODE_REQUIRED` : aucune
tentative avec une autre clé, aucun repli en clair, aucune écriture. La saisie
du code est alors demandée par Race Control seul.

## 5. Responsabilités inchangées

Race Control reste seul détenteur du code, de la clé, du chiffrement et du
déchiffrement. Control Vault peut transporter le descripteur comme fichier
public opaque mais ne dérive, ne vérifie ni n'utilise jamais la clé. Le
contrôle GCM ne prouve pas l'auteur d'un paquet ; il prouve seulement la
connaissance du code au moment de la création du descripteur.

## 6. Risques acceptés et limites

Un script de même origine pendant la durée de la session peut utiliser la clé
conservée ; c'est le même modèle que la clé de coffre mémorisée, d'où
l'obligation d'une origine dédiée avant toute activation. Un sel stable n'abaisse
pas le coût d'attaque d'un paquet unique : tous les paquets d'un compte
dépendent déjà du même code. Le changement de code crée un nouveau descripteur ;
les anciens paquets restent lisibles avec l'ancien code, sans conversion.

Les révisions, parents, conflits et le catalogue de synchronisation feront
l'objet d'un addendum A2 distinct. A1 ne définit aucun ordre de versions.
