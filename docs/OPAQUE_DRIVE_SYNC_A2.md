# Transport des révisions A2 — préparation désactivée

Le fournisseur opaque accepte désormais `uploadRevision` en plus des exports
manuels V1. Chaque nouveau fichier porte les propriétés `rcr`, `rcd`, `rcs` et
`rcp0` à `rcp2` du contrat A2. Le parseur exige des identifiants canoniques,
un compteur entier sûr et positif, au plus huit parents distincts triés, et
des groupes de trois sans trou. Une propriété inconnue du préfixe `rc` ou une
révision partielle bloque le catalogue ; aucun fichier n'est effacé.

L'envoi et les reprises comparent ces métadonnées à la référence figée avant
la première attente, puis relisent les octets du paquet et leurs empreintes.
Un changement de révision, même avec des octets inchangés, interdit une preuve
de relecture. Deux versions concurrentes restent deux fichiers ; le catalogue
ne choisit aucune tête. Les paquets manuels sans révision restent acceptés,
sans conversion automatique en révision.

`unverified` et `verified-bytes` gardent leur sens du lot B2 : même après une
relecture réussie, **les métadonnées de révision ne sont pas authentifiées**.
Race Control doit ouvrir le paquet avec GCM/AAD et comparer exactement son
champ chiffré `rev` aux propriétés, avant tout calcul de têtes ou import.
Vault ne reçoit ni code ni clé et n'ajoute aucune fonction de déchiffrement.

Tests unitaires sur réseau fictif : bornes et formes ambiguës ; trois versions
dont deux enfants concurrents ; remplacement/suppression des propriétés ;
collision d'identifiant ; reprise après perte de réponse ; mutation de l'entrée
pendant l'attente ; V1 manuel conservé. Ils ne prouvent ni OAuth/Drive réel,
ni synchronisation métier, ni restauration F01–F09, ni Safari sur iPhone physique.

Dépendance documentaire : Control Vault #11, copie exacte de la proposition
A2 de Race Control. Le défaut de collision de contenu côté propriétaire doit
être corrigé par Race Control #228 avant tout raccord réel. Le fournisseur
reste absent du build produit, qui conserve sa démonstration. Aucun écran,
workflow, secret, domaine, session ou stockage de production n'est modifié.

Revue sensible obligatoire avant fusion. Retour arrière : retirer ce module
et l'extension du transport ; aucune donnée réelle créée ou migrée. Les futurs
fichiers distants ne doivent jamais être supprimés par un retour logiciel.

Référence vérifiée le 23 octobre 2026 :
[Google Drive — propriétés personnalisées](https://developers.google.com/workspace/drive/api/guides/properties)
(`appProperties` privées à l'application, 124 octets UTF-8 clé et valeur comprises).
La visibilité depuis les deux origines avec le même client OAuth et `drive.file`
reste à démontrer avant activation, selon le lot B2.
