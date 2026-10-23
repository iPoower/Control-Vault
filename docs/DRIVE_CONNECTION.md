# Google Drive — raccord proposé le 23 octobre 2026

**Code à relire par le propriétaire ; connexion réelle et publication non attestées ici.** Les contrats V1/A1/A2 restent inchangés. Les documents des lots précédents décrivent leur état historique.

Un espace **Google Drive** est accessible depuis la navigation PC et Réglages sur iPhone. Il charge GIS et Google Picker après action, demande uniquement `drive.file`, vérifie le dossier choisi et affiche les versions opaques de Race Control. Les autres écrans restent des démonstrations : `DemoDrive` et les imports JSON métier ne sont pas remplacés par le fournisseur réel.

## Données et preuves

- Aucun code ou clé Race Control n'entre dans Vault. RC chiffre, authentifie, fusionne et restaure sur sa propre origine. Vault vérifie la forme, les tailles, les empreintes et les octets ; **une empreinte identique ne prouve pas l'authenticité GCM ni la restauration**.
- L'envoi accepte uniquement un paquet `race-control-backup` déjà chiffré validé par `readRacePacket`. Un JSON de profil en clair ou un ancien export incomplet est refusé avant envoi. Les autres chemins d'upload du prototype restent attachés à `DemoDrive` ; aucune sauvegarde de Reconversion Control n'est envoyée par ce parcours.
- Une copie locale opaque est relue dans `OpaqueArchive`, puis le travail et son identifiant Drive réservé sont conservés dans `cv-drive-outbox-v1` avant l'envoi. Un bouton reprend ce travail après reconnexion. Une empreinte lie l'envoi au compte et au dossier d'origine. Aucun transfert automatique vers un autre compte/dossier.
- Les fichiers sont immuables, jamais supprimés ni remplacés. Les métadonnées A2 sont conservées pour les révisions reçues ; un fichier importé manuellement sans métadonnées de révision est une copie manuelle, jamais une tête A2 inventée.
- « Vérifier et télécharger » relit les métadonnées et les octets, les conserve dans une archive locale, puis exporte le paquet chiffré. L'import et le code se font dans **Race Control → Réglages → Sauvegarde**. Les fichiers A2 sont pris en charge par le raccord propriétaire correspondant.
- Le descripteur public A1 est transportable séparément (JSON strict, 2 Kio, encodages/tailles exacts, fichier immuable, relecture). Le transport ne dérive pas de clé et ne contrôle pas GCM. Seul RC crée ou utilise ce profil.

Jetons Google en mémoire uniquement, ni URL d'API, ni IDB, ni stockage Web, ni journal. Rechargement, déconnexion et expiration exigent une reconnexion volontaire. Le choix du dossier repasse par Picker à chaque nouvelle session. Aucune passerelle `postMessage`, aucun partage de stockage ou de jeton avec RC, aucun besoin de fenêtre Vault ouverte pour que RC synchronise.

## Configuration de production

Dans les deux dépôts, la variable Actions publique **`GOOGLE_DRIVE_CONFIG`** a exactement six champs : `approved`, `clientId`, `apiKey`, `appId`, `raceOrigin`, `vaultOrigin`. Client OAuth Web et projet Google identiques. Clé navigateur Picker restreinte aux API et référents requis par Google. Aucun secret client, jeton, compte, code ou dossier dans cette variable ou le dépôt public.

Le build de démonstration garde une configuration nulle et sa CSP sans Google. Le pipeline construit un **second artefact isolé**, contrôle aussi sa sécurité, puis publie cet artefact exact sur Cloudflare, sans reconstruction au déploiement. Avec une configuration approuvée, sa CSP autorise les bibliothèques GIS/Picker et les seuls endpoints Google nécessaires ; COOP devient `same-origin-allow-popups`. La configuration reste un fichier public séparé, sans cache, dont l'empreinte figure dans `version.json`. Le scanner n'autorise des identifiants navigateur que dans ce fichier généré et validé ; les mêmes motifs restent interdits dans le dépôt public et les bundles.

**Aucune activation sans revue explicite des PR sensibles des deux applications, preuve d'origines exclusives/isolées, configuration OAuth et visibilité mutuelle réelle avec le même client, migration chiffrée récupérable et F01–F09, y compris iPhone physique.** `approved: true` est une décision du propriétaire après ces preuves, jamais un résultat déduit des tests simulés. Tous les hôtes `github.io` sont refusés au runtime, même avec une configuration.

## Validation et limites

`drive-connection.test.ts` vérifie le transport du descripteur réel généré par le codec propriétaire de test, l'immuabilité/relecture, les doublons JSON, le refus du clair et le schéma de configuration. `drive-build.test.ts` construit le profil isolé, vérifie sa CSP et le scanner et démontre que le build de démo refuse une configuration Google.

`connected-drive.spec.ts` exerce l'interface construite : connexion explicite, dossier Picker, envoi opaque, relecture, téléchargement, refus du clair, perte du jeton au rechargement et refus de `github.io`. Toutes les réponses Google y sont fictives. Les tests B1/B2/A1/A2, l'intégrité, les versions concurrentes, l'isolation SW et le pipeline restent obligatoires. Aucune recette Google réelle ni iPhone physique n'est revendiquée.

Retour arrière : retirer la configuration puis déployer par le pipeline normal ; fermer/déconnecter les sessions existantes. Revert du code par PR. Ne supprimer ni fichier Drive, ni archive, ni file IDB, ni ancienne installation. Un revert de code ne restaure pas les données ; utiliser une copie chiffrée vérifiée dans RC. Aucun changement de SW ni de cache d'une autre application.

Sources officielles relues le **23/10/2026** : [GIS token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [CSP/COOP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [Picker Web](https://developers.google.com/workspace/drive/picker/guides/web-picker), [drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [appProperties](https://developers.google.com/workspace/drive/api/guides/properties), [envoi](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [lecture](https://developers.google.com/workspace/drive/api/guides/manage-downloads).
