# Race Control ↔ Control Vault — addendum A2 : révisions et conflits

**Statut : proposition, revue humaine obligatoire, aucune activation.**

Complète `docs/INTEGRATION.md` et l'addendum A1 sans les modifier. Doit être
strictement identique dans les deux dépôts. En cas de doute, V1 puis A1 prévalent.

## 1. Révision immuable

Chaque envoi crée un nouveau fichier ; aucun fichier n'est remplacé, modifié ou
supprimé par la synchronisation. Une révision porte : `id` (32 hexadécimaux
aléatoires), `parents` (0 à 8 identifiants distincts, triés, sans elle-même),
`device` (32 hexadécimaux aléatoires propres à un profil d'appareil) et `seq`
(entier ≥ 1, croissant pour cet appareil). Aucune autre information.

## 2. Double inscription, une seule autorité

Ces métadonnées figurent :

- en clair dans les propriétés du fichier fournisseur : `rcr` (id), `rcd`
  (device), `rcs` (seq en décimal canonique), `rcp0`…`rcp2` (parents par
  groupes de trois séparés par des virgules, sans trou) ; chaque couple clé +
  valeur ≤ 124 octets ;
- dans le contenu chiffré du paquet (champ `rev`).

Les propriétés en clair servent à lister et reconstruire le catalogue. Elles ne
font jamais autorité : Race Control relit les octets (SHA-256 de référence),
authentifie le paquet (V1 + A1), puis exige l'égalité exacte avec `rev`. Sinon :
refus `REVISION_MISMATCH`, fichier conservé et signalé, jamais intégré. Une
révision non authentifiée ne peut donc pas déclarer une autre copie intégrée.

## 3. Contenu chiffré de synchronisation

`{ "app": "twrc-sync", "v": 1, "at", "rev", "values" }`, où `values` contient
les valeurs durables du coffre Race Control (clés `twrc.*` → texte), à
l'exclusion de l'état propre à l'appareil : position et lieu, trajet en cours,
sessions et clés, caches, diagnostic d'exécution, état local de synchronisation.
La liste est celle de `SyncMerge.device` ; une clé inconnue reçue est conservée
localement et signalée, jamais adoptée automatiquement. Control Vault ne voit
que l'enveloppe V1 opaque.

## 4. Têtes, intégration et conflits

Sur les seules révisions authentifiées : une tête est une révision dont aucune
autre ne cite l'identifiant. Une tête non couverte par l'état local est à
intégrer avec la fusion sans perte de Race Control. Ensuite :

- aucun conflit signalé → la tête est intégrée ;
- conflit signalé (réglage sans preuve de fraîcheur, véhicule ambigu, clé
  inconnue différente) → la tête **n'est pas** déclarée intégrée, la valeur
  locale reste, la tête distante demeure visible et restaurable jusqu'au choix
  explicite de l'utilisateur ;
- une révision n'est publiée que si l'état durable local a changé ou si
  plusieurs têtes sont jointes ; ses parents sont exactement les têtes intégrées.

Un cycle ou deux révisions de même `id` et de contenus différents bloquent toute
écriture. Un parent absent, une base locale introuvable ou une révision de cet
appareil plus récente que son compteur (profil copié ou restauré) sont signalés ;
le compteur suivant dépasse toujours la plus grande valeur vue.

## 5. Ce que fait Control Vault

Il catalogue chaque fichier, ses empreintes et ces propriétés minimales, affiche
toutes les versions et les têtes multiples sans en choisir une, et remet un
fichier intact à Race Control pour restauration. Il ne fusionne, ne déchiffre et
ne supprime rien. Le catalogue est reconstructible depuis les fichiers.

## 6. Limites

Une suppression locale n'est pas propagée (choix « conserver plutôt que perdre »).
Les horodatages de réglages (`twrc.editstamps.v1`) ne sont pas encore produits par
l'application : sans eux, toute divergence de réglage est un conflit à arbitrer.
