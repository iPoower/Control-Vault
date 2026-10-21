# Lot C — prévol des origines et interopérabilité propriétaire

Statut : préparation non activée, revue sensible obligatoire. Les deux
applications publiques restent sur GitHub Pages. Aucune origine dédiée,
configuration Google, migration, connexion, clé ou donnée réelle n’est créée
par ce lot. Les vues existantes et leurs assets de production restent identiques.
Reconversion Control n’est ni consulté ni modifié.

## Prévol public, sans autorisation implicite

Le module non importé par l’application `src/core/origin-readiness.ts` et le CLI
`node scripts/check-origins.ts configuration-publique.json` vérifient deux
applications explicitement configurées. Le fichier contient uniquement les
champs suivants pour `race` et `vault` :

- `baseURL` : URL HTTPS canonique, terminée par `/`, sans identifiant, port,
  query ou fragment. Les deux origines doivent être distinctes ; les hébergements
  partagés `github.io`, adresses IP et hôtes locaux sont refusés avant réseau.
- `sha` : SHA Git complet du code revu, 40 caractères hexadécimaux minuscules.
- `hashes` : SHA-256 exacts des fichiers revus `index.html`,
  `manifest.webmanifest`, `sw.js`, sous les clés `index`, `manifest`, `worker`.

Ne pas remplir ce fichier avec un token, une clé API, un mot de passe, une
adresse de redirection OAuth ou un secret d’hébergeur : les propriétés non
prévues sont refusées. Produire les empreintes depuis les artifacts du build
validé, pas depuis le site à contrôler. L’outil compare les octets réellement
reçus à ces références et compare `version.json.sha` au commit attendu. Il
vérifie également l’identité du manifest et sa portée. Un simple HTTP 200 ou
un SHA annoncé dans un fichier ne suffit pas.

Chaque lecture est un GET public, sans cookies ni Authorization, avec
redirections interdites, cache désactivé, sans referrer. Les tailles des corps
réellement lus sont bornées et l’attente des en-têtes et du corps est limitée
à dix secondes. Le rapport affiche des codes et les origines publiques, jamais
le contenu des réponses ou une configuration d’authentification.

Sont requis sur les quatre ressources : CSP HTTP stricte (la meta ne suffit
pas), scripts locaux ou autorisés par SHA-256, aucun eval ni inline non signé,
frame-ancestors/object/base/form/worker/manifest bornés, nosniff, DENY, HSTS,
Referrer/Permissions-Policy, COOP et CORP same-origin. Aucun cookie de domaine
ni CORS d’accès croisé n’est accepté sur ces ressources statiques. Le worker
doit être revalidable et ne peut élargir sa portée déclarée. La politique
préserve le GPS `(self)` de Race Control ; il reste interdit pour Vault.

`technical-checks-passed` signifie seulement que ces lectures publiques sont
conformes. Le rapport conserve cinq dépendances obligatoires :
propriété et usage exclusif des hôtes ; sessions/stockages/SW testés dans les
navigateurs ; migration par fichier récupérable puis iPhone physique ; revue
du profil CSP/COOP du parcours OAuth ; même
client OAuth et visibilité réelle `drive.file` démontrée des deux côtés.
Ce résultat n’active jamais Google ou une migration. `blocked` retourne un
code d’échec. Les domaines réels ne sont pas encore configurés.

## Réutilisation des préparations Race Control

Les dossiers `fortress-origin-plan.md` et `fortress-ii-origin-preparation.md`
de Race Control restent la référence pour l’inventaire, le relais public,
le maintien de l’ancienne PWA et la répétition réversible. Les PR préparatoires
Race Control #134 à #143 restent indépendantes ; ce lot ne les modifie pas.
Une origine différente ne prouve pas qu’un projet d’hébergement est exclusif.
La recette devra confirmer cela auprès de l’hébergeur.

Le build RC fictif testé sur son `main` produit une ligne CSP de 1172 caractères,
compatible avec la limite documentée de 2000 caractères par ligne Cloudflare
Pages. Il manque encore CORP dans ses en-têtes préparatoires : le prévol le
signalera. Le futur raccord d’hébergement doit corriger ce point dans une PR
RC sensible dédiée puis vérifier les en-têtes réellement servis. Rien n’est
déduit des en-têtes de la démonstration GitHub Pages, qui ignore `_headers`.

Sources techniques consultées le 21 octobre 2026 :
[Cloudflare Pages — Headers](https://developers.cloudflare.com/pages/configuration/headers/),
[Google — Use the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).
La stratégie retenue reste `drive.file` avec le même client Web OAuth autorisé
sur les deux origines ; aucun espace privé `appData` n’est supposé partagé.
Les tokens resteront en mémoire. Leur expiration peut nécessiter une nouvelle
action utilisateur : aucune reconnexion silencieuse permanente n’est promise.
Le prévol vérifie le profil **avant OAuth**. Le chargement de GIS nécessitera
une évolution revue de la CSP. Selon le parcours choisi, une fenêtre Google
peut aussi exiger `same-origin-allow-popups` ; il faut le démontrer et revoir
explicitement cette politique, pas déclarer le futur OAuth compatible avec
le COOP actuel. Voir aussi
[Google — Setup / COOP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

## Preuve propriétaire RC, jamais une clé dans Vault

Les anciens tests fabriquaient leur chiffré dans un oracle indépendant. Ils
utilisent désormais un instantané **exact** du codec RC de la PR #216, commit
`7f7e36fbd3083c84ca9e6a62ee5c28185de94d65`. Le code est uniquement dans
`tests/fixtures/race-owner/` ; il n’est ni importé ni exposé dans le bundle Vault.
Les instantanés 61/120 sont produits par les vrais modules Backup/JournalArchive
et le générateur RC, avec empreintes de provenance. Les données sont fictives :
lieux A/B, un véhicule, relevé kilométrique, profondeur, entretien, trajets de
91/365 jours, plusieurs retours et ancien champ non affichable.

Le propriétaire Node chiffre le métier V2 avec l’archive intégrale existante.
Vault reçoit seulement les octets opaques. Ses parcours existants relisent
l’archive IndexedDB après fermeture du navigateur et les deux profils relisent
les versions dans le Drive **simulé**. Le propriétaire reconstruit une nouvelle
clé depuis le seul code fictif et le paquet, avec contrôle du hash de référence.
Le test indépendant de déchiffrement reste aussi en place dans le parcours Drive.
Le test de réindentation est explicite car le vrai producteur écrit du JSON compact.

Cela renforce F01/F02/F03/F06/F08 sur les composants et les navigateurs, sans
fermer F01–F09 de bout en bout : pas de capture du profil réel, d’application
transactionnelle dans l’UX RC, de Drive réel, de résolution des écritures
concurrentes ni d’iPhone physique. Le validateur métier final reste côté RC.
Le contrat `docs/INTEGRATION.md` n’est pas modifié.

## Retour arrière

Retirer le prévol, son CLI et les tests/fixtures revient au comportement de
production inchangé. Aucune donnée à annuler, aucun cache supprimé, aucune
DNS/permission/clé à révoquer. La revue sensible explicite est nécessaire
avant fusion ; les dépendances d’activation restent obligatoires après fusion.
