# Personal staging acceptance — 2026-10-11

Scope: ai-native-runtime-v2-staging / staging only. Production unchanged.

## Observed results

- Personal credential login succeeded in the cloud browser. Session remained authenticated across full page reload, project navigation, and backend-only deployments.
- Project creation succeeded through the console UI. Project `7ecd2d43-5ce4-491a-8fc9-ec4c2fd06bdd`, key `staging-acceptance-20261011`, name `预发验收测试 20261011`, remained visible after a full reload and return to project list.
- Existing RC1 project `31a642c1-e0ee-4e36-a799-44ac50a825b1` displayed the explicitly marked test asset and its version. UI file authorization succeeded and browser download completed.
- Download: 63 bytes; SHA-256 `b512446299139d6386abb1a865e794659f1e25e1e44581da0fac748c30dd8f97`. Matches server-side S3 GET verification and DB fingerprint.
- Fixture asset `a3110000-0000-4000-8000-000000000002`, version `a3110000-0000-4000-8000-000000000003`; fixture script guards exact staging environment, workspace, tenant and RC1 project. No user asset overwritten.
- Runtime deploy `addd4ec3-2562-482f-a66f-36844ea5e227`: SUCCESS, SHA `5fe2ad3013500b353ad6b94bfb09d060fff152bb`.
- Console deploy `ea048a2b-f7a4-432c-88d7-9e5d2718dc5f`: SUCCESS, SHA `82211e37664b686bf458649eba6a293be3614505`.
- GitHub CI runs 38132419081 and 38132419093: completed/success for runtime fixture commit.
- Temporary fixture pre-deploy command removed. Service config restored to `npm run predeploy:v22-production`; no staged changes remain.

## Release limits and recovery

The basic personal staging path (login, persistent project creation, scoped test asset download) passed. This does not mean production release or complete frontend Gate passed.

Railway reports rollback capability for current deployments. Known code recovery targets: backend `9582b6e2358cac5e5c4bea8d6d0057964c4eeaca`, console `82211e37664b686bf458649eba6a293be3614505`. Re-pin the exact source SHA within this staging environment, preserve ordinary pre-deploy command, inspect staged changes, deploy, verify SUCCESS and /ready. The additive test rows/object can remain as marked evidence; this workflow requires no schema rollback. No rollback drill was executed.

Remaining: console login sessions still live in process memory and are lost on console restart; secure credential prompts expire independently. UI incorrectly labels the migrated test version `文件引用未登记` even though authorization and download work. Header still says FRONTEND GATE 未通过. Historical Library assets are not migrated. Requirement Agent consolidation PRs remain separate and undeployed; these acceptance results cannot certify that change.

Test project, test asset and manual fixture script are retained as clearly marked acceptance evidence. No credentials or cookies are recorded here.
