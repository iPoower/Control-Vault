# Politique de sécurité — Control Vault

## Engagements

- **Aucun secret dans ce dépôt.** Il est public et servi par GitHub Pages. L'identifiant client OAuth Google (Phase 2) et la clé `anon` Supabase (Phase 4) sont publics par nature et limités par les origines autorisées et la RLS. Aucun jeton, mot de passe ou clé privée n'y figurera jamais.
- **Chiffrement côté appareil** (AES-256-GCM) avant tout envoi. La clé est dérivée d'une phrase secrète (PBKDF2-SHA-256, 600 000 itérations) et n'est jamais transmise ni stockée.
- **Permissions Google minimales** : `drive.file` uniquement. Les dossiers existants sont autorisés explicitement via le sélecteur Google.
- **Jetons en mémoire uniquement**, jamais dans `localStorage`, `sessionStorage` ou IndexedDB.
- **Intégrité SHA-256** vérifiée après chaque envoi et avant chaque restauration.
- **Aucune écriture silencieuse** : pas d'écrasement, pas de suppression automatique, copie de sécurité avant toute restauration.
- **CSP stricte** (`default-src 'self'`, aucun script ni style externe). Les domaines Google et Supabase ne seront ajoutés qu'avec les phases qui les utilisent.
- **Isolation Supabase** : tables `vault_*` dédiées, RLS `owner = auth.uid()`. La table `reconversion_progress` n'est ni lue ni modifiée.

## Point ouvert avant la Phase 2

`ipoower.github.io` est partagé avec d'autres pages GitHub (dont Race Control) : même origine, donc même stockage local. Avant toute connexion réelle à Google, Control Vault doit être servi depuis une origine dédiée (par exemple Cloudflare Pages, gratuit). L'écran Sécurité le signale tant que ce n'est pas fait.

## Signaler un problème

Ouvre une issue privée (Security advisory) sur ce dépôt.
