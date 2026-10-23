# Frontière compte et destination — NOESIS, 23 octobre 2026

Statut : préparation sensible, revue humaine obligatoire, aucune fusion ni activation cloud autorisée par cette PR. Cette note ne modifie pas les contrats normatifs V1/A1/A2.

## Défauts reproduits avant correction

Deux contre-tests du fournisseur, exécutés sur la version antérieure, échouent : un dossier personnel simplement accessible en écriture est accepté ; un fichier déplacé hors du dossier sélectionné peut encore être téléchargé et annoncé vérifié si ses empreintes concordent.

## Correction limitée au périmètre

Le choix du compte reste dans l'interface officielle Google, avec `prompt: select_account`, le seul scope `drive.file` et aucun consentement automatique. Après le retour Google, l'application lit seulement l'identité du compte courant (`about.get`, permissionId/emailAddress), l'affiche en mémoire et exige une confirmation explicite avant Picker, réservation d'ID ou accès aux fichiers. Ni compte, ni adresse, ni jeton ne sont persistés ou consignés. L'application ne peut pas déterminer seule si le compte est personnel : l'utilisateur doit choisir un compte de test dédié. La configuration de production reste absente/désactivée.

Le dossier est neuf, créé par l'application avec un ID réservé et la marque privée `rc-folder-v1`, puis relu. Sa sélection reste explicite dans Google Picker. Le fournisseur exige son identité, sa propriété, son type, l'absence de corbeille et le droit d'ajout. Aucune modification, suppression, exploration générale ou labellisation d'un dossier existant. Un dossier ancien non marqué est refusé : aucune migration implicite. Le même dossier marqué peut être choisi sur l'autre appareil avec le même projet/client OAuth autorisé.

Listes et relectures sont limitées au dossier choisi, aux marques `rc-v1`/`rc-key-a1` et aux métadonnées attendues. Le parent du fichier est vérifié avant sa lecture. Une empreinte SHA-256 reste une preuve d'octets, pas une authentification GCM : celle-ci appartient uniquement à Race Control. Un ajout extérieur au dossier ou une suppression par un utilisateur autorisé n'est pas empêché par cette marque.

Le jeton est exclusivement en mémoire. Expiration, déconnexion et révocation connue invalident la sélection. Les callbacks d'un ancien compte ou d'un ancien Picker ne réactivent pas la nouvelle session. Un changement de destination invalide le bail réseau précédent. Une opération persistée conserve sa liaison opaque compte/client/dossier et ne peut être reprise ailleurs. Le marquage du dossier ne remplace ni l'autorisation Google ni la comparaison de cette liaison.

La création du dossier réutilise l'ID réservé pendant la session si une réponse est perdue. Après fermeture complète avant confirmation du dossier, il faut retrouver explicitement le dossier existant dans Picker ; ne pas annoncer une reprise persistante de cette préparation de dossier. Les files d'archives conservent déjà durablement leurs octets et identifiants, séparément.

Race Control suspend son moteur avant un changement de destination, attend la fin de l'ancienne exécution, et ne valide pas son résultat tardif. La file reste conservée ; un paquet éventuellement créé est relu avec son ID initial lors d'une reprise autorisée dans sa destination initiale. Les données métier restent exclusivement dans Race Control.

Control Vault affiche le compte et le dossier sélectionnés, la date d'opération, la file connue et les états distincts attente/envoi/envoyé/octets vérifiés/blocage/erreur. Les têtes A2 listées restent déclaratives avant authentification dans Race Control. Aucun déchiffrement ou arbitrage métier dans Vault.

## Reproduction et vérifications

- Vault : `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run security`, `CI=1 npm run test:e2e` ; les deux moteurs et les quatre projets de viewport restent requis.
- Contre-tests : `tests/unit/drive-boundary.test.ts` (dossier non dédié, parent divergent, confirmation, changement de compte, callbacks tardifs, création idempotente et révocation).
- Parcours navigateur : `tests/e2e/connected-drive.spec.ts` (Google entièrement intercepté, données fictives, confirmation avant création/Picker, relecture et téléchargement, rejet du clair, oubli du jeton au rechargement).
- Race Control : `node tests/run-ci.js --lane unit`, `BROWSER=chromium node tests/e2e85-drive-runtime.js`, puis `BROWSER=webkit node tests/e2e85-drive-runtime.js` ; suite CI complète avant toute décision de fusion. `tests/test_drive_sync.js` vérifie aussi le changement de destination pendant l'envoi.
- Reproduction statique du fournisseur dans Race Control : `node tools/vendor-vault-drive.js ../Control-Vault`. Les SHA-256 des quatre sources sont inscrits dans l'en-tête généré. Le module GIS est identique entre dépôts, hormis l'export ES de Vault.

Ces preuves sont unitaires et d'intégration avec réseau Google simulé. Aucun appel Google réel, aucun compte personnel, aucune validation sur un iPhone physique. VALIDATION PHYSIQUE EN ATTENTE.

## Environnement réel à autoriser séparément

Deux origines HTTPS de test indépendantes, un client OAuth Web de test commun à ces seules origines, une clé Picker restreinte, un compte Google de test confirmé par l'utilisateur et un dossier neuf sont nécessaires. La création de ressources administratives et leur publication nécessitent un GO ciblé distinct. Le schéma public reste exactement `approved`, `clientId`, `apiKey`, `appId`, `raceOrigin`, `vaultOrigin`. Aucun compte/dossier/jeton/secret ajouté au schéma. Ne jamais configurer un secret client OAuth dans une application statique.

L'autorisation `approved: true` est réservée au futur environnement de test isolé après validation de ses ressources. Aucun changement des variables ou secrets de production. Aucun accès réel depuis `ipoower.github.io`. Les essais réels doivent démontrer les droits effectifs sur les fichiers des deux applications : Picker seul ne prouve pas ces droits.

## Risques, dépendances et récupération

Modification sensible commune aux deux clients : relire les deux PR et la compatibilité du fournisseur reproduit. La PR de sécurité CI/CD Control Vault #16 reste séparée et non fusionnée. Aucun changement de workflow, permission, secret, données existantes, contrat normatif, service worker ou animation.

Le retour arrière concerne le code uniquement, par PR et après accord. Ne jamais effacer la file, les bases locales, le dossier ou les archives pour faciliter un retour arrière. Une installation ancienne non marquée reste disponible ; son export chiffré et sa restauration isolée doivent être validés avant toute migration personnelle explicite.

Aucune promesse de synchronisation permanente d'une PWA fermée sur iOS. Reprise seulement application ouverte, autorisée, connectée et coffre déverrouillé ; expiration Google implique une action humaine. Un succès HTTP ne constitue pas une sauvegarde vérifiée, et les octets vérifiés par Vault ne constituent pas une restauration réussie.
