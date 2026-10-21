# Lot B2 — transport Drive des paquets opaques

Statut : proposition sensible non branchée, empilée sur #7 puis #6. Aucun OAuth,
compte réel, domaine, migration, configuration de sécurité ou écran modifié.
Le build produit garde son fournisseur de démonstration. Ce module ne remplace
pas `StorageProvider` : ses chemins d'import JSON ne doivent jamais atteindre Drive.

## Stratégie commune proposée

`drive.file` seulement, conformément à SECURITY.md. Pas de `drive.appdata` ni
d'hypothèse d'accès entre deux applications OAuth. Le lot C devra utiliser un même
client OAuth Web, autorisé explicitement pour les deux origines dédiées, avec le
même compte Google et un dossier choisi via Picker. Les `appProperties` sont
privées à l'application : visibilité des fichiers ET propriétés à prouver depuis
les deux origines réelles avant activation. Avec deux clients/projets différents,
ne pas activer ce chemin sans contrat et preuve d'accès révisés.

Le code sans dépendance UI peut s'exécuter depuis Race Control, sans fenêtre
Control Vault ouverte. Il ne lit aucun stockage, session ou Service Worker d'une
autre application. Chaque application obtient sa propre session en mémoire ;
aucun jeton n'est partagé ou échangé entre origines. Aucune communication
inter-origines, clé RC ou donnée déchiffrée n'est nécessaire au transport.

## Garanties du fournisseur préparé

- Origine HTTPS exacte autorisée ; toutes les origines github.io sont refusées,
  même dans la liste. Cette barrière ne remplace pas la recette domaines/CSP.
- Jeton reçu de l'appelant, durée bornée, marge d'expiration, mémoire privée
  uniquement, scope minimal vérifié ; aucune acquisition ni reconnexion implicite.
  Une réponse d'une ancienne session ne peut devenir preuve du nouveau compte.
- OAuth dans l'en-tête Authorization seulement. Redirections refusées, URL de
  session limitée au endpoint Google attendu, jamais persistée ou journalisée.
  Requêtes sans cache HTTP, cookie ni referrer : une copie en cache ne vaut pas
  nouvelle preuve de relecture distante.
- Réservation d'identifiant Google avant création. L'appelant doit persister
  l'association identifiant/empreinte/appareil avant l'envoi : cette file durable
  n'est pas implémentée ici. Un réessai avec cet ID relit une copie terminée ;
  une collision différente refuse sans écrasement. Pas de PATCH ni DELETE.
- Paquet strictement revalidé avant réseau. Envoi resumable en morceaux de 1 Mio,
  accusés Range contrôlés ; progression des octets reçus, jamais « synchronisé ».
- Après envoi, métadonnées et octets sont retéléchargés, bornés et comparés aux
  empreintes initiales. Un checksum déclaré par Drive ne vaut pas preuve.
- Le catalogue reconstruit depuis Drive parcourt toutes les pages. Recherche
  incomplète, pagination cyclique, métadonnées ambiguës ou collision refusées ;
  aucune limitation du nombre de versions et aucune purge d'anciennes copies.
- Réponses bornées, annulation et délais réseau/corps ; quota, session expirée,
  coupure et corruption restent des échecs. La copie locale précédente demeure.

`unverified` décrit une entrée de catalogue. `verified-bytes` ne prouve que la
relecture de ces octets à cet instant, liée à cet ID/hash ; ce n'est ni une preuve
d'authenticité, ni une preuve de dernière révision, ni l'état global « Protégé ».
Le cache B1 reste `local-only`. Une référence fournie par un catalogue distant
doit être considérée non authentifiée ; seul le propriétaire RC vérifie GCM/AAD
et ses invariants métier avant toute restauration. Aucun déchiffrement dans Vault.

## Vérification

Tests unitaires : scope/origine, jetons expirés et anciennes réponses, coupure
après écriture puis réessai idempotent, collision sans remplacement, corpus JSON
refusé avant réseau, faux checksum, URL hostile, morceaux/accusés, quota,
annulation après en-têtes, réponse tronquée/sans longueur, pagination complète.

Test navigateur exécuté dans les quatre projets CI Chromium/WebKit bureau/iPhone
émulé : deux profils isolés, envoi de 120 trajets fictifs, fermeture du premier
profil, téléchargement dans le second, nouvelle version de 61 trajets dans le
sens retour, récupération des deux copies puis corruption refusée sans purge.
Le code du vrai fournisseur utilise fetch et les en-têtes/CORS sur un serveur
Drive entièrement simulé. L'adaptateur de test propriétaire reconstitue une clé
neuve depuis le code et le paquet pour authentifier/déchiffrer hors Vault.
Il n'utilise pas le futur producteur/import métier Race Control, encore absent.

Ces tests ne prouvent ni OAuth/Picker/Drive réel ni Safari/PWA sur appareil
physique, réseau mobile, quotas iOS, veille, F01–F09 complètes ou synchronisation.

## Dépendances avant connexion et synchronisation

1. Revue humaine de #6/#7 et de ce lot sur leurs têtes exactes ; CI contre main
   après intégration des dépendances. Ne pas déployer une dépendance fictive.
2. Origines distinctes, en-têtes/CSP stricts, isolation SW/stockages et migration
   récupérable vérifiée avant abandon de l'ancienne PWA ; OAuth/Picker revus.
3. Producteur et import propriétaire RC pour le contrat V1, sauvegarde préalable,
   validation GCM/AAD/métier et preuves F01–F09, y compris sur appareils physiques.
4. File durable locale, reçus de preuve persistés, réconciliation au démarrage,
   rattachement compte/dossier/appareil et traitement d'une session d'envoi
   incomplète. Le module seul ne reprend pas les morceaux après fermeture.
5. Addendum contractuel versionné des révisions/conflits avant synchronisation
   automatique. Chaque version reste un fichier distinct ; pas de « dernière
   version » arbitraire, d'écrasement, de suppression ou de merge métier ici.
   Ne pas synchroniser GPS instantané, sessions ou trajet actif d'un appareil.

Sans ces dépendances, aucune fonction réelle ne doit être activée. L'éventuel
index secondaire reste facultatif et reconstructible ; aucune dépendance à Supabase.
La cryptographie durable des fichiers génériques `.cvault` v2 reste distincte et
non implémentée, selon CRYPTO.md. Les paquets RC opaques ne sont pas ré-enveloppés.

## Retour arrière et impact

Diff limité à un nouveau service, ses tests et ce document. UX, dépendances,
workflow, contrat normatif et projets voisins inchangés. Retirer le module non
branché annule la proposition sans migration ni suppression. Après une future
activation revue, un retour logiciel ne doit jamais effacer les copies Drive ou
IndexedDB ; les paquets restent récupérables sans index secondaire.

## Références vérifiées

- https://developers.google.com/workspace/drive/api/guides/manage-uploads
  (envoi resumable, morceaux multiples de 256 Kio, ID prégénéré et réessais 409).
- https://developers.google.com/workspace/drive/api/guides/manage-downloads
  (relecture `alt=media`).
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
  (pagination et incompleteSearch).
- https://developers.google.com/workspace/drive/api/guides/properties
  (appProperties privées à l'application, bornes de taille).
