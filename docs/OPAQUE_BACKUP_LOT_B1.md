# Lot B1 — copies Race Control opaques et récupérables

Statut : préparation sensible, désactivée dans l'interface. Dépend de la PR #6.
Aucun compte Google réel, changement de domaine, migration ou accès à Race Control.

## Résultat proposé

`race-packet.ts` implémente le lecteur de structure/intégrité du contrat V1 existant :
limites de taille avant lecture, UTF-8 strict, doublons JSON décodés, profondeur,
champs stricts, dates, versions, Base64 canonique et SHA-256 du chiffré/tag. Une
seconde empreinte couvre le fichier complet et sert de référence stable. Les
octets originaux sont conservés, y compris indentation et ordre des propriétés.
Le module n'a aucune clé et n'appelle jamais decrypt ou deriveKey.

`opaque-archive.ts` conserve ces paquets dans IndexedDB `cv-opaque-packets-v1`.
Une version est identifiée par le SHA-256 complet du fichier, jamais remplacée
ni purgée automatiquement. Le doublon exact est idempotent, y compris entre deux
transactions concurrentes. La confirmation attend le commit puis une relecture
avec validation des octets et de l'empreinte de référence. Le catalogue lit une
copie à la fois ; une ligne corrompue refuse un résultat annoncé complet, sans
la supprimer. Quota, blocage ou version de base inconnue ne sont pas un succès.

L'unique état de ce cache est **local-only**. Il ne peut produire « Protégé »,
« Sauvegardé dans Drive » ou « Synchronisé ». Il ne contient aucun code, clé,
jeton, session OAuth ou donnée déchiffrée. Les bases et caches d'autres applications
ne sont ni lus ni effacés. Il reste soumis aux quotas/évictions du navigateur :
Drive sera la vérité distante au lot suivant, pas ce cache.

## Périmètre cryptographique

Le contrat impose à Race Control de chiffrer et d'authentifier ses paquets. Control
Vault ne les ré-enveloppe pas avec sa clé de démonstration. Ainsi, perdre la
session/clé Control Vault n'empêche pas de récupérer les octets originaux. Ce
travail n'implémente pas le format `.cvault` v2 ni Argon2id des données génériques
propres à Vault ; cette proposition distincte de CRYPTO.md reste à développer et
à revoir avant activation de ces autres sauvegardes.

Un hash cohérent n'authentifie pas le contenu. Les tests produisent un paquet
fictif avec GCM/AAD exactement selon le contrat et ne déchiffrent que dans un
adaptateur de test propriétaire, hors Vault. Une altération avec hash recalculé
peut passer la structure/intégrité et doit échouer à l'authentification propriétaire.

## Preuves

- Contrat normatif inchangé ; anciens formats refusés explicitement par le nouveau
  lecteur, sans changement de l'import historique Race Control.
- Tests unitaires du vrai lecteur : forme, ambiguïtés, UTF-8, doublons échappés,
  coût KDF, Base64/padding, références d'empreinte, immutabilité des octets.
- Tests Chromium/WebKit sur bureau et iPhone émulé : 61/120 trajets fictifs,
  91/365 jours et deux retours ; enregistrement concurrent, deux versions,
  fermeture complète du processus navigateur puis réouverture du profil,
  octets identiques et déchiffrement indépendant hors Vault.
- Quota simulé et corruption : copie précédente conservée, refus sans purge.

Ces preuves ne constituent pas F01–F09 complètes : Race Control publié ne produit
pas encore cette nouvelle enveloppe ; son futur lecteur/import métier reste à
brancher. Le passage Google réel, les origines isolées, le protocole de révisions,
la restauration préalable vérifiée et les appareils physiques restent bloquants.
Le harness est compilé uniquement par les tests, pas livré dans le build produit.

## Revue et retour arrière

PR empilée sur la branche de #6 pour garder un diff indépendant et sa CI complète.
Ne pas fusionner automatiquement ; accord humain requis sur la tête exacte.
Ni #6 ni ce lot ne sont autorisés à activer Drive. L'interface et les parcours de
démonstration sont inchangés. Avant fusion, aucun effet de production. Après une
éventuelle fusion revue, retirer le lecteur et le cache ne supprime aucune copie
existante ; ne pas effacer la base pour un retour logiciel. Safari/iPhone physique,
quotas matériels et purge iOS non testés.
