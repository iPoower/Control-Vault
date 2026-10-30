# Reçus et récupération RC — 25 octobre 2026

Auteur : Bryan. Correction sensible, non fusionnée, non déployée.
Base dépendante : #19, qui inclut #17. #16 et #18 restent séparées ; #20 est
une preuve temporaire à ne pas fusionner. Aucune branche source modifiée.

## Défaut reproduit et correction

Lors d'un téléchargement, #19 relit le reçu durable et s'assure que le job
d'upload concurrent est intact. La comparaison par JSON.stringify transforme
son Uint8Array chiffré entier en objet JSON numérique, deux fois. Avec la limite
contractuelle de fichier, ces chaînes peuvent occuper bien plus de mémoire que
le fichier. Aucune panne physique ni perte personnelle n'est supposée.

Le nouveau contre-test place un upload synthétique de 2 Mio en attente et refuse
sa sérialisation JSON. Il échoue sur #19 (null au lieu des octets téléchargés),
puis passe avec sameJob. La comparaison vérifie la forme connue, la liaison,
l'identifiant réservé, l'empreinte, la longueur et chaque octet sans conversion
JSON. Une seule différence d'octet interdit VERIFIED_BYTES. Les quatre tests
antérieurs restent intacts ; le journal avant correction est conservé.

La copie Uint8Array reste gérée par les mêmes archives et transactions IDB.
Aucune réduction de taille du ciphertext, aucune suppression ou nouvelle
compression n'est revendiquée. Ce changement évite une allocation inutile ; il
ne chiffre pas un gain de RAM d'un iPhone réel non mesuré.

## Frontière de confiance et lien de récupération

L'écran Drive garde le parcours d'import dans Race Control et ajoute le lien
`<raceOrigin>/recovery.html`. Cette page appartient au candidat RC de récupération
A2 du 25 octobre. Publier les deux candidats compatibles après leurs GO séparés.
Ne pas présenter ce lien comme un parcours disponible dans la production actuelle.

Control Vault ne demande jamais le code, ne déchiffre pas et ne choisit pas une
tête A2. Le code et la comparaison métier restent dans RC. Le lien utilise
uniquement l'origine validée de la configuration, aucun paquet, code, jeton ou
identifiant privé dans l'URL, avec noopener/noreferrer. Les tests de l'interface
vérifient le lien et l'absence de champ mot de passe.

## Validation et limites

Reproduire : `npm run typecheck`, `npm test`, `npm run build`, `npm run security`,
`CI=1 npm run test:e2e`. Le workflow Chromium/WebKit existant reste inchangé.
Vérifier la CI sur le SHA exact de cette PR ; les anciennes CI ne la valident pas.

Les réponses Google des tests sont fictives. Les comptes, restrictions de clé
Picker, appProperties et visibilité entre les origines doivent être vérifiés
sur un compte de test autorisé, puis sur iPhone physique. Aucun essai réel,
configuration Google, déploiement ou transmission personnelle dans ce lot.

## Impact et retour arrière

Changement local au contrôle de reçu et à un lien explicite ; aucun format,
scope, secret, schéma IDB, cache, contrat V1/A1/A2 ou CI modifié. Ne jamais fusionner
la PR temporaire #20. Revert logiciel par PR après GO, sans purger les jobs,
archives, reçus, fichiers Drive ou stockages d'autres applications.
