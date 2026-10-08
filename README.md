# Control Vault

Application personnelle de stockage, de sauvegarde et de restauration — PWA pensée d'abord pour iPhone, pleinement utilisable sur ordinateur. Google Drive pour les fichiers, Supabase Free pour l'index, 0 € par mois.

> **Phase 1 — prototype UX.** Toutes les données sont fictives et recréées à chaque ouverture. Aucune connexion à Google ni à Supabase. Les moteurs, eux, sont réels : sérialisation, SHA-256, AES-256-GCM, relecture et comparaison d'empreintes s'exécutent vraiment, contre un Drive de démonstration en mémoire.

## Ce que fait le prototype

| Écran | Contenu |
|---|---|
| Accueil | Cadran d'état calculé (4 sources), points à traiter, stockage, connexions, dernières opérations |
| Fichiers | Navigation dans le coffre, fil d'Ariane, recherche globale, filtres, tri, liste ou grille, aperçu, sélection multiple, import JSON contrôlé, appui long et glissement |
| Applications | Race Control et Reconversion Control : statut, versions, sauvegarde, restauration |
| Historique | Chronologie par jour, durée, taille, intégrité, erreurs expliquées avec « Réessayer » |
| Sécurité | Chiffrement, permissions Google, sessions, contrôle d'intégrité global, récupération, hébergement |
| Réglages | Compte, stockage, applications, sauvegardes, notifications, apparence, données, situations simulées |

**Situations simulées** (Réglages › Démonstration) : hors ligne, session Google expirée, envoi interrompu, Supabase injoignable. Le mode avion réel fonctionne aussi.

**Clavier** : `Ctrl/⌘ K` recherche rapide · `/` recherche de fichiers · `G` puis `A/F/H/P/S/R` pour naviguer · `?` aide.

## Développement

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # tests unitaires (cœur : état, crypto, différences, validation)
npm run build
npm run test:e2e     # parcours + accessibilité (Chromium ; WebKit en CI ou PW_WEBKIT=1)
npm run check        # tout, dans l'ordre
```

## Gouvernance

Branche → PR → « Vérification complète » (audit, types, unitaires, build, contrôle de sécurité, parcours Chromium + WebKit, WCAG 2.2 AA) → revue → fusion → publication de l'artefact vérifié → contrôle du commit servi. Rien ne se fait directement sur `main`. Les changements sensibles exigent une revue humaine : voir [SECURITY.md](SECURITY.md) et [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [Architecture et analyse adverse](docs/ARCHITECTURE.md)
- [Design system](docs/DESIGN.md)
- [Politique de sécurité](SECURITY.md)
- [Publication et protections](docs/DEPLOYMENT.md)
- [Gouvernance du chiffrement](docs/CRYPTO.md)

## Feuille de route

1. ✅ Prototype UX premium (ce dépôt)
2. Authentification Google, navigation réelle dans Drive (Picker + `drive.file`)
3. Phrase secrète, chiffrement réel, imports et restaurations
4. Tables `vault_*` dans Supabase, RLS
5. Contrats d'intégration Race Control et Reconversion Control
6. Durcissement, performance, publication
