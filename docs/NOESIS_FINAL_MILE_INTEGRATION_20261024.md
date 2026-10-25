> Archive de validation historique : ce document décrit les PR temporaires #239/#20, qui restent exclues de fusion et de publication. Il ne définit pas la branche TEST actuelle ; voir DRIVE_REAL_TEST_20261025.md. Aucune archive n’est supprimée.

# NOESIS Final Mile — integration fixture only

This disposable branch combines #16, #17, #18 and #19 without changing their source branches.
#19 includes #17 and retains that dependency. Merges were conflict-free.
The V1/A1/A2 contract files remain byte-identical to Race Control.

Local combined validation: TypeScript, 21 Vitest suites / 334 tests, Vite build and
security scanner passed. Browser CI must be verified on the exact new head before
claiming combined browser success. The Google provider in browser tests is simulated.
Control Vault transports opaque bytes and dated integrity receipts; it cannot authenticate
AES-GCM, validate business data or establish successful Race Control restoration.

This branch is for CI/review only and must not be merged or deployed. No administrative
change or personal activation is authorized. Rollback: leave the branch unused; all
source branches and main stay unchanged. Original PRs require explicit human approval.

Additional browser regression imports the real DriveStore and exercises native IDB
transaction abort, connection close/reopen, its versionchange handler and WebCrypto
recovery byte comparison. This new head needs its own full CI.
## Complément de validation — 25 octobre 2026

La combinaison de test conserve #16–#19 et les épreuves IDB natives, puis ajoute
#21 (7a2b78b037711816a99b4c47c666223a0cdb8031) : comparaison des jobs chiffrés
sans expansion JSON et lien vers la récupération qui reste exécutée dans RC.
Le code de déchiffrement n'entre jamais dans Control Vault.

NE PAS FUSIONNER NI DÉPLOYER cette PR temporaire. Sa tête historique
3d177ac58173944599150d8d18515417375b9eb6 reste dans ses ancêtres. Aucun main
ou branche source n'est modifié. Vérifier sa nouvelle CI au SHA exact ; les
réponses Google sont fictives et aucun iPhone physique n'est validé.

