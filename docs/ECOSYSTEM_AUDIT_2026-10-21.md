# Audit Control Vault × Race Control — 21 octobre 2026

Verdict : **orange, préparation du lot A**. Aucun accès Google réel, migration, nouvelle origine ou synchronisation n'est activé. Aucune recette sur appareil physique n'a été réalisée. Les interfaces existantes restent la cible ; aucune nouvelle application n'est créée.

## Bases inspectées

- Control Vault main et contrat #5 : `07d6de09e60ff36061a9b45bc5bbc07ecdee68a2`.
- Control Vault #6 : `b2bb5750ebb78780bdc87b9a906a1d2fcca6547b`, démonstration en mémoire, clé éphémère. La branche Phase 2 est inspectée en lecture seule, sans modification ni activation.
- Race Control main : `eb52a66b11f566a86b56aac9dd0f7988ed5dc5c0`, prod-154.
- Race Control #213, #182 et #184 actualisées sur ce main, en PR sensibles distinctes.
- `AGENTS.md` des deux projets, `INTEGRATION.md`, `ARCHITECTURE.md`, `CRYPTO.md`, `SECURITY.md` et `DEPLOYMENT.md` lus.

Le contrat `docs/INTEGRATION.md` est identique dans les deux dépôts : 22 074 octets, SHA-256 `874da448f445d46e76a65dfb1c266b61effced3a2168ac125f77b9658cbdcc37`, blob `3432a39de502416db3a5d4001efe4b5f684c466f`. Il reste inchangé. Ce rapport est une décision préparatoire ; il ne remplace pas le contrat V1 par fichiers ni n'autorise un nouveau transport.

## Constats et corrections du lot A

| Sévérité | Constat | Traitement |
|---|---|---|
| Haute | Origine GitHub Pages commune : les chemins ne séparent pas les stockages, scripts et jetons | Connexion Google interdite avant deux origines dédiées vérifiées et migration contrôlée |
| Haute | #213 : écriture récursive de chemins importés, alerte CodeQL de pollution de prototype | Refus explicite des segments de prototype, accès aux seules propriétés propres, indices de tableaux contrôlés, régression hostile |
| Haute | #213 : union météo tronquée à 30/200, pertes silencieuses | Refus intégral si capacité dépassée ; déduplication exacte à la limite acceptée |
| Haute | #184 : rollback d'import pouvant écraser une écriture concurrente ; double sélection possible | Publication comparée avant rollback, conflit annoncé, verrou d'import local ; conflit avec le dernier main résolu en conservant le parcours Exporter actuel |
| Haute | #182 : import météo tronqué | Refus de tout le plan sans écriture plutôt que suppression d'observations |
| Moyenne | #213 : horodatages adoptés malgré un conflit de véhicule | Horodatage refusé conservé localement ; liste complète de véhicules non remplaçable ; identifiants ambigus refusés |
| Moyenne | #213 : clés inconnues copiées automatiquement | Pas d'adoption automatique ; écart signalé pour adaptateur explicite |
| Bloquante | Control Vault : fournisseur mémoire et clé de démonstration non récupérable après fermeture | Lot B requis ; ne pas présenter cette démo comme une sauvegarde durable |

Le journal cumulatif de Race Control est déjà présent sur main depuis les travaux précédents. B01/B02/B03 ne sont plus des mécanismes de suppression dans cette archive : aucune limite de 60, aucune purge à 90 jours, toutes les versions complètes restent archivées. La projection peut choisir un retour pour l'affichage sans effacer les sources. Cela ne valide pas encore le passage croisé par Control Vault ni les appareils physiques.

Le moteur #213 reste **non inclus dans le build**, sans stockage, chiffrement ou réseau. Les conflits signalés ne sont pas résolus automatiquement. Une suppression n'est pas propagée. Aucun journal ancien déjà perdu n'est reconstitué.

## Preuves F01 à F09 : état précis

Les essais exécutables disponibles sont lancés sur données fictives. Une preuve partielle n'est pas comptée comme complète.

| Preuve | Exécuté / vérifiable dans le lot A | Reste bloquant |
|---|---|---|
| F01 | Suites journal et sauvegarde : 120 trajets bruts ; sync : 61 et 120, fusion et relecture JSON sans perte | Enveloppe V1 réellement émise/lue et passage Control Vault avec téléchargement, import puis réouverture |
| F02 | Entrées de 91/365 jours dans les mêmes suites, relecture à +400 jours | Même parcours croisé complet |
| F03 | Retours concurrents, même milliseconde, identifiants distincts et source historique opaque conservés dans l'archive | Parcours croisé et restauration de versions sélectionnées |
| F04 | Copie chiffrée relue avant activation du journal ; union du journal local enrichi, refus sur copie incomplète ; #184 rollback conditionnel | Copie préalable récupérable obligatoire avant toute future restauration automatique de l'ensemble du profil |
| F05 | Quota, relecture interrompue, reprise, deux contextes et double import simulés par les suites existantes et #184 | Pannes à chaque étape du vrai fournisseur et reprise sur appareils physiques |
| F06 | Mauvais code et chiffré invalide refusés dans les chemins historiques ; contrats testés séparément | Nouvelle enveloppe AES-GCM/AAD normative pas encore implémentée ; attaque avec hash recalculé dans ce vrai parcours |
| F07 | Compatibilité V1/V2 historique et version future refusée dans les suites existantes | Producteur futur / version du shell effectif dans le futur lecteur de l'enveloppe V1 |
| F08 | #6 relit les octets de démo et préserve les versions ; aucun paquet Race Control n'est déchiffré par Vault | Stockage réel, paquet opaque autonome, perte de session Vault puis récupération sur nouveau terminal |
| F09 | Matrices Chromium/WebKit relancées sur les têtes exactes des PR, iPhone émulé distinct du matériel | Safari/PWA iPhone et PC physiques, y compris migration et fermeture complète |

**F01–F09 complètes restent bloquantes.** Ne pas transformer les tests de schéma ou le fournisseur mémoire en preuve de récupération réelle.

## Décision Google Drive pour les lots suivants

Retenir **`drive.file`**, déjà imposé par `SECURITY.md`. Ne pas utiliser `drive.appdata` : l'espace privé d'une autre application n'est pas accessible par hypothèse. Google documente l'accès limité aux fichiers créés/ouverts/autorisés avec l'application et le Picker.

Préparer un seul client OAuth web d'écosystème, autorisant explicitement les deux futures origines HTTPS exactes. Chaque application demande son propre jeton éphémère en mémoire et appelle directement Drive avec le même fournisseur audité ; aucun jeton, clé ou message de stockage n'est partagé entre applications. L'accès effectif aux fichiers créés de chaque côté doit être démontré sur un compte de test avant activation, pas déduit du nom du client. Sinon, refus et sélection explicite des fichiers par Picker, sans élargir les scopes.

Le code fournisseur sera réutilisé dans les builds existants, jamais dépendant d'une fenêtre Control Vault ouverte. Race Control chiffre ; Control Vault valide structure/empreinte et catalogue des octets opaques. Les autres données propres à Control Vault nécessitent la cryptographie durable du lot B prévue dans `CRYPTO.md` ; ne pas la remplacer silencieusement par le chiffrement de démonstration.

Les jetons sont oubliés à expiration/déconnexion et ne sont jamais persistés. Le modèle Google côté navigateur exige un geste utilisateur pour obtenir un nouveau jeton après expiration : afficher « Reconnexion requise », conserver la file locale et ne pas promettre une synchronisation autonome permanente. Synchronisation à l'ouverture/reprise/pendant l'usage quand l'autorisation est valide ; aucune exécution permanente sur PWA iOS suspendue.

## Versions et concurrence : exigences à implémenter après revue

- Une sauvegarde = nouveau fichier immuable, identifiant de révision aléatoire et parents explicites. Réessai avec identité stable ; aucune mise à jour destructive d'une ancienne copie.
- Lecture des octets distants et SHA-256 comparé à la référence attendue avant état vérifié. Un hash cohérent n'authentifie pas les métadonnées : Race Control vérifie GCM/AAD et valide le contenu privé.
- Le catalogue est reconstructible depuis les fichiers Drive et les métadonnées minimales autorisées. Un index ou un « dernier fichier » mutable n'est pas l'arbitre de vérité. Supabase non requis pour cette étape.
- Deux écritures concurrentes créent deux branches récupérables. Les détecter après énumération complète/pagination et revérification ; créer une révision de fusion seulement après validation sans perte. Ne pas annoncer « Synchronisé » sur le seul horodatage ou sur la fin de l'upload.
- Un protocole de révisions dépasse le transport manuel V1 : préparer un addendum versionné, identique et relu dans les deux dépôts AVANT implémentation. Ne pas surcharger les métadonnées de l'enveloppe V1, dont les propriétés supplémentaires sont interdites.
- Ne transporter ni état GPS instantané, ni session, ni cache, ni trajet actif de l'autre appareil. Ne jamais transférer de clair ou de clé à Control Vault.

## Ordre de livraison et revue

A : trois PR RC de fiabilité, sans transfert réel. B : terminer #6 après revue, fournisseur réel sans activation et cryptographie durable avec ses essais de récupération. C : origines/en-têtes, migration vérifiée conservant l'ancienne PWA, OAuth, adaptateurs et contrat versionné. D : protocole de concurrence, hors ligne, reprises et essais physiques. E : adaptateur Reconversion Control séparé après stabilisation ; aucune de ses données n'est lue/modifiée dans ce lot.

Aucune fusion sensible automatique. Le propriétaire doit relire les diffs, têtes et preuves des PR, puis donner son accord explicite ; les contrôles physiques requis restent à réaliser et ne sont pas déduits de WebKit. Aucun service indisponible n'est supposé opérationnel pour fusionner une fonction.

Retour arrière : avant fusion, les PR n'altèrent aucune donnée de production. Après une éventuelle fusion revue, retour logiciel par PR sans purge ni migration inverse. Conserver toutes les copies ; un revert logiciel ne restaure pas des données et peut réintroduire un défaut corrigé.

## Sources primaires relues le 21/10/2026

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
