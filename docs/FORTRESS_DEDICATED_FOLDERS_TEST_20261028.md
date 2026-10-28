# Dossiers dédiés via l’API Drive — candidat TEST du 28 octobre 2026

Le parcours existant crée et relit un dossier dédié, mais impose ensuite Google Picker. Ce candidat ajoute une sélection explicite parmi les dossiers déjà autorisés à l’application. Il ne change aucun réglage de cookies ou de navigateur et ne prétend pas réparer le contrôle manuel du navigateur cloud.

## Périmètre et autorité

- RC : base 7e5cd990f7f736ab77220bb2b35fad643407e672 ; CV : base 3675ec1128675e007a1e341379bf28c8eebe6431, qui reprend le durcissement CSP séparé.
- Branches TEST isolées, PR en brouillon, aucune fusion ni production. Les résultats appartiennent au SHA effectivement testé.
- Origines autorisées : rc-drive-test-ipoower.pages.dev et cv-drive-test-ipoower.pages.dev.

## Contrôles et impact

La requête officielle files.list utilise le scope existant drive.file, l’espace drive, le propriétaire courant, le type dossier, l’absence de corbeille et la propriété privée cv_contract=rc-folder-v1. Chaque réponse est contrôlée à nouveau. Un résultat incomplet, un doublon, une boucle ou le dépassement de 10 pages / 1 000 dossiers bloque la liste au lieu de la tronquer.

La sélection est explicite et limitée aux identifiants de la liste obtenue dans la session courante. Le compte est relu ; propriétaire, contrat et droit d’ajouter des fichiers sont relus avant de calculer la liaison existante client/compte/dossier. Une déconnexion ou expiration invalide la liste. Les noms sont rendus comme texte, y compris s’ils contiennent du HTML.

Aucun ajout de scope, jeton persistant, nouvel endpoint serveur, crypto, schéma de coffre, file durable, migration, suppression, permission Google, règle de sécurité, dépendance ou workflow. Les paquets restent chiffrés par RC et opaques pour CV. Les lecteurs et le stockage existants sont réutilisés. Le transport RC est reconstruit par tools/vendor-vault-drive.js à partir des sources CV, avec empreintes dans son en-tête.

Le parcours Picker est conservé, de même que les anciens échecs documentés. Les tests Google simulé vérifient les deux parcours ; la voie API est également éprouvée avec Picker rendu indisponible dans le harnais. Cela n’établit pas la cause d’une panne iPhone ou du contrôle manuel cloud.

## Validation et limites

Tests ciblés : pagination complète, propriétaire/contrat/type/capacité, réponse incomplète ou tardive, liste invalidée, compte changé, liaison équivalente à Picker, conservation des files et des refus de récupération avant écriture. Parcours navigateur : sélection explicite, nom hostile rendu comme texte, upload et relecture avec réseau Google simulé.

La CI et le manifeste de chaque nouvel artefact doivent être attestés avant publication TEST. Une CI verte ne prouve ni transfert Google réel, ni installation vierge indépendante, ni persistance physique. Aucun RPO/RTO n’est déduit des minuteries.

## Retour arrière

Ne pas publier le candidat, ou remettre le précédent artefact TEST attesté après contrôle des octets. Le contrat de stockage et les codecs sont inchangés ; aucune purge n’est requise. Préserver tous les dossiers et révisions créés. Un retour du code ne constitue pas un retour des données. Les preuves de compatibilité existantes restent datées et ne couvrent pas des migrations futures.

## Références officielles

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/search-files
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
