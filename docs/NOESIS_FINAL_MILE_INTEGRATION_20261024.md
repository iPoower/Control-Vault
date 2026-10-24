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
