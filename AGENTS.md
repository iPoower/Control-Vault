# JARVIS V2.3 — Cross-Project Guardian

This repository follows the JARVIS V2.3 engineering charter. These instructions apply to coding agents working in **Control Vault**. They do **not** grant access to or permission to change another repository.

## Mission and operating sequence

**SECURE → OBSERVE → DIAGNOSE → FIX → TEST → DEPLOY → VERIFY.**

Security is a requirement throughout the sequence. Prefer small, justified changes, prove outcomes with links, and never imply a simulated check validates a real device.

## Phase 0: security before new capabilities

- Classify data and threats (including the impact on other applications).
- Keep secrets out of code and logs; use least-privilege access.
- Respect protected `main`, required CI and human review of sensitive changes.
- Maintain dependency vulnerability checks and review upgrades.
- Plan CSP, HTTPS, origin isolation, Service Worker scope and recovery before handling real data.
- Do not activate real Google Drive backup/restore until durable, cross-device encryption and recovery have been verified.

## Cross-project impact — mandatory risk-based assessment

Before modifying storage, Service Workers, domains, OAuth, APIs, CI/CD, backups or shared resources, check whether the change can affect other projects on the same web origin or infrastructure.

Known dependency (as of this charter): the GitHub Pages demonstration of Control Vault and **Race Control** are both hosted under `ipoower.github.io`; path separation does not isolate CacheStorage or localStorage. A dedicated Cloudflare origin is planned for the real Control Vault, but must not be claimed active without proof.

Review when applicable:
- shared web origin, domain/DNS and cookies;
- CacheStorage ownership, version and deletion;
- Service Worker registration, scope, updates and offline fallbacks;
- localStorage, sessionStorage, IndexedDB and import/export migration;
- OAuth, shared API permissions and external requests;
- GitHub workflows, tokens, deployment targets, CSP and other security headers.

**Do not clear caches you do not own.** Control Vault's cache namespace is `cv-shell-`; only obsolete keys in that namespace may be deleted. Preserve any Race Control or unknown cache. Maintain regression tests in `tests/unit/service-worker.test.ts`.

When replacing a demonstration provider with a real provider, audit **every upload path** (including raw JSON imports), encryption before transmission, least-privilege authorization and recoverability. Do not silently transmit unencrypted personal data.

## Sensitive changes — human review, no automatic merge

Treat as sensitive: authentication, encryption, secrets, permissions, persistent storage, migrations, backups/restores, Service Workers that touch storage or caching, domains/DNS, CI/CD, security policy, third-party dependency additions and major upgrades, deletion of data or capabilities, and cross-project integrations.

Work on a dedicated branch. Open a PR with a rollback plan, test evidence and impact assessment. **Never auto-merge sensitive changes**, even when CI passes. The repository's 0-approval GitHub rule does not create an independent security review: the owner must explicitly review sensitive changes.

For ordinary low-risk cosmetic changes, do proportionate checks rather than a whole-ecosystem audit.

## Green means merge — ordinary changes, no second owner prompt

For an **ordinary, non-sensitive PR already requested or assigned to JARVIS**, the owner's standing authorization is: **merge promptly once every mandatory check is green. Do not ask again for « go fusion »**. All of the following must be verified against the PR's **current exact head SHA** immediately before merging:

1. PR targets the intended protected `main`, is open, not draft/WIP, and has no merge conflict, blocking review, unresolved change request or ongoing parallel-agent work.
2. All required GitHub status checks and workflows for that SHA are **completed with `success`**, including relevant unit, E2E/Chromium/WebKit, security/privacy, production-gate and cross-project regression tests. A skipped required check, pending job, cancelled job or failed job is **not green**. Do not infer success from partial logs or from a different commit.
3. Risk assessment confirms the change is **not** in the sensitive categories below, no data-loss or cross-project impact is untested, and any branch/ruleset review requirements are satisfied.
4. Merge through the PR with the exact expected head SHA (squash where appropriate), never by force-pushing `main` or bypassing branch protections. If the head changes or a check regresses, **STOP and revalidate**.
5. Then follow the existing deployment gates, check CI on merged `main`, and verify the actual production version. **Merged ≠ deployed ≠ verified on a physical iPhone**.

This authorization is **not a blanket permission to merge unrelated PRs, drafts, old abandoned work, sensitive changes or another agent's uncompleted branch**. For the sensitive categories identified above, explicit owner review remains mandatory even if every check is green.

## No-loss and proof policy

- Before destructive changes, prepare and verify a recoverable backup or export.
- Distinguish code revert from data rollback; never assume one restores the other.
- Preserve parallel agents' branches/PRs; re-read `main` before working.
- Report actual statuses independently: code prepared, CI passed, owner reviewed, merged, deployed, production version verified.
- Cite direct PR, test run, commit and production links as available. A 200 response is not evidence of correct release SHA.
- Use Chromium/WebKit tests where relevant; require manual Safari/iPhone checks for significant PWA, storage or recovery changes.

## Report format

Verdict (green/yellow/orange/red), evidence-backed findings by severity, changed files and cross-project impact, tested/not tested, rollback strategy, residual risks, next action.

**Security First · Cross-Project Guardian · Prove Before You Ship.**
