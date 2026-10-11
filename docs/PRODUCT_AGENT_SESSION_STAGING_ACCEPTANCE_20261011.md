# Product Agent integration and session recovery — staging acceptance

Date: 2026-10-11 (Asia/Shanghai). Scope: staging environment fc068d5a-6664-42df-8bae-c84cbc569601 only.

This follow-up supersedes the pending Agent integration and memory-session limitations recorded in STAGING_PERSONAL_ACCEPTANCE_20261011.md. Production remains unchanged.

## Implementation

Requirement analysis, completion, decision merge and PRD preparation have one PRODUCT_AGENT owner. Completion remains CAP-REQ-COMPLETION-V1 in INTEGRATED mode. Existing routes and DB schema remain compatible. Obsolete draft frontend PR18 and backend PR21 were closed as superseded; no duplicate merge is needed.

Personal sessions are encrypted with AES-256-GCM on a private 100 MB console volume mounted at /data, with a stable server-only key. The browser receives only a random HttpOnly/SameSite cookie. Personal TTL remains 8 hours; credential-admin TTL remains 30 minutes and admin sessions remain memory-only. Logout removes persisted session data; Runtime 401 revocation invalidates the personal session; Runtime 403 does not log the user out. Key rotation intentionally invalidates old sessions. Preserve the volume and key during deployments. Expired sessions are removed when accessed. No session values, tokens or keys are in this report.

S3-backed versions now display 已登记受控文件，待校验授权 instead of incorrectly saying 文件引用未登记. No test fixture is in the normal pre-deploy command.

## Verification

- Local console check: 26 tests PASS, including restart, tampering, wrong-key, expiry, durable logout and revocation.
- Local requirement runtime: 4 tests PASS, including same-agent completion and PRD owner.
- Frontend CI: 38138662038, 38138662059, 38138662066, 38138662074 — all completed/success.
- Backend CI: 38138663767, 38138663770, 38138663783 — all completed/success.
- Frontend SHA a79eaa6b6707bdf2b2223ff10165b7d3754bfa28; initial deployment f18e8846-4f01-4538-b139-8a711682938f SUCCESS.
- Backend SHA 9181915340f699b99a6f27ec709d3f8548cf3a23; deployment 6b037f43-f3d8-4a3a-91a4-44e7e7ce39c5 SUCCESS.
- Actual console redeploy 66fa8f32-8d80-4232-99bb-d9cff92ddc39 SUCCESS, same frontend SHA. After reload, existing personal session still showed 个人授权 · 可执行, and real project data loaded without another login.
- /healthz and Runtime /ready returned 200.
- Live test in project 7ecd2d43-5ce4-491a-8fc9-ec4c2fd06bdd: one-line project-list requirement ran against the configured real model. Trace prefix d3c9c64e. Model reported completeness 92% (model output, not a release score), one pending decision. Test chose the recommended existing-permissions option, submitted decisions, then generated PRD preparation package. After full reload and reopening history: 已生成 PRD 整理包, zero pending decisions, same trace.
- Download regression after deployment: 63 bytes, SHA256 b512446299139d6386abb1a865e794659f1e25e1e44581da0fac748c30dd8f97, matches controlled object and DB fingerprint.

## Release decision

PASS for this staging scope: single-owner requirement workflow, real execution and persistence, personal session survival across actual console redeploy, file-reference display and download regression. This is not production release approval or full independent production audit. The main console's FRONTEND GATE 未通过 header is still a static label; do not infer a new CI failure from it or treat this report as a full platform Gate. Historical Library assets remain outside the tested download scope.
