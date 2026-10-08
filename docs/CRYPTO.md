# Gouvernance du chiffrement — étude préalable à la Phase 3

> **Statut : étude, rien n'est activé.** Aujourd'hui, Control Vault ne chiffre que des données de démonstration avec une clé de session éphémère, perdue à la fermeture de l'onglet. **Aucune sauvegarde réelle et durable ne sera activée avant la validation complète de la Phase 3, avec revue humaine.**

## Le problème à résoudre

La phrase secrète de l'utilisateur doit devenir une clé AES-256 sans être stockée nulle part. Si un fichier `.cvault` fuit (Drive compromis, partage par erreur), seule la difficulté de deviner la phrase protège son contenu. La fonction de dérivation (KDF) fixe le coût de chaque essai pour un attaquant.

## PBKDF2 ou Argon2id

| Critère | PBKDF2-HMAC-SHA-256 | Argon2id |
|---|---|---|
| Référence OWASP | 600 000 itérations | Minimum : 19 Mio et 2 passes, ou 46 Mio et 1 passe (configurations équivalentes) |
| Résistance aux GPU et ASIC | Faible : calcul seul, peu de mémoire | Forte : chaque essai mobilise de la mémoire |
| Disponibilité navigateur | Native (Web Crypto), y compris Safari | Pas native dans Safari : bibliothèque WebAssembly |
| Code tiers | Aucun | Une dépendance à auditer et à figer |
| CSP | Inchangée | `'wasm-unsafe-eval'` à ajouter dans `script-src` (WebAssembly uniquement, pas `unsafe-eval`) |
| Parallélisme | Non applicable | En pratique `p = 1` : les threads WebAssembly exigent l'isolation cross-origin (COOP/COEP), incompatible avec la fenêtre de connexion Google |

## Contraintes de l'iPhone 11 Pro Max

- Puce A13, 4 Go de RAM. Un onglet Safari dispose largement de 64 Mio pour un calcul ponctuel. Le risque se situe au-delà de plusieurs centaines de Mio, ou dans une extension iOS, plus limitée en mémoire.
- WebAssembly mono-thread : le temps de calcul dépend directement de la mémoire × nombre de passes.
- Repère public : Bitwarden fixe par défaut Argon2id à 32 Mio, 6 passes, parallélisme 4. Il avertit au-delà de 64 Mio dans l'autoremplissage iOS, qui est une extension et non Safari.

## Recommandation

1. **Argon2id**, avec des paramètres de départ **m = 64 Mio, t = 3, p = 1**. C'est plus de trois fois le minimum OWASP en mémoire. L'objectif est un déverrouillage d'environ 1 à 2 s sur l'iPhone 11 Pro Max.
2. **Étalonnage sur l'appareil réel avant activation** : une page de mesure livrée avec la PR de Phase 3, que tu lances toi-même sur ton iPhone. Si le temps dépasse 2 s, on descend vers m = 46 Mio, t = 2. On ne descend jamais sous le minimum OWASP.
3. **Paramètres inscrits dans chaque fichier.** Le format v2 enregistre l'algorithme, la mémoire, les passes et le sel. On peut ainsi durcir les réglages plus tard sans rendre illisibles les anciennes sauvegardes.
4. **Aucune dégradation silencieuse.** Si Argon2id ne peut pas tourner (mémoire, WebAssembly bloqué), l'application refuse de chiffrer et le dit. Elle ne bascule pas d'elle-même sur un algorithme plus faible.
5. **PBKDF2 600 000 reste le plan de secours documenté**, à n'activer qu'après revue, si la bibliothèque Argon2id posait un problème de sécurité ou de compatibilité.

## Hiérarchie de clés prévue

```
phrase secrète ──Argon2id──► clé de chiffrement de clé (KEK)
                                   │ enveloppe (AES-KW)
clé de récupération (aléatoire, 128 bits, notée sur papier) ──► KEK de secours
                                   ▼
                    clé de données (DEK, AES-256-GCM, aléatoire)
                                   ▼
                       sauvegardes .cvault
```

- Changer de phrase secrète revient à ré-envelopper la DEK, sans rechiffrer les sauvegardes.
- Sans phrase secrète ni clé de récupération, les sauvegardes sont illisibles par conception, y compris pour toi.

## Format v2 (proposé)

```
"CVLT" | 2 | kdf (1 = Argon2id, 2 = PBKDF2) | paramètres | sel (16) | IV (12) | AES-256-GCM(données) + tag
```

L'en-tête est authentifié comme donnée associée de GCM : modifier un paramètre rend le fichier invalide.

## Tests obligatoires avant d'activer de vraies sauvegardes

| # | Scénario | Attendu |
|---|---|---|
| 1 | Sauvegarder, fermer complètement le navigateur, rouvrir, restaurer | Restauration identique, octet pour octet |
| 2 | Sauvegarder sur l'iPhone, restaurer sur le PC (et l'inverse) | Identique |
| 3 | Mauvaise phrase secrète | Refus clair, aucune donnée modifiée |
| 4 | Un octet du fichier altéré | Refus « fichier altéré » |
| 5 | Phrase oubliée, clé de récupération correcte | Accès rétabli, nouvelle phrase définie |
| 6 | Paramètres KDF durcis ensuite | Les anciennes sauvegardes restent lisibles |
| 7 | Mémoire insuffisante simulée | Refus explicite, pas de repli silencieux |
| 8 | Vecteurs de test officiels Argon2id (RFC 9106) | Sorties identiques |

Les scénarios 1 et 2 doivent aussi être faits **par toi, sur tes vrais appareils**. Les tests WebKit automatisés ne remplacent pas un iPhone réel.

## Sources

- OWASP, Password Storage Cheat Sheet : https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- Bitwarden, KDF algorithms : https://bitwarden.com/help/kdf-algorithms/
- RFC 9106 (Argon2) : https://www.rfc-editor.org/rfc/rfc9106
