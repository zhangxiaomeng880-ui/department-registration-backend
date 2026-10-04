# AI Native Runtime v2.0 RC2 — Railway

Frozen Railway release candidate:

- Branch: `release/ai-native-runtime-v2.0-rc2-railway`
- Commit: `17dd8482b64cb6c503adcea6135afb1535c11bdf`
- Router: `router-p86-v1`
- Workflow: `context-orchestrator-v1`

## Same-SHA validation evidence

- Backend Validation #132 — PASS
- Runtime Orchestrator Validation #40 — PASS
- Runtime Deployment Validation #26 — PASS
- Railway Runtime Compatibility #1 — PASS
- VPS Deployment Scripts Validation #17 — PASS

## Railway-specific guarantees

- Railway `PORT` is honored.
- Railway `MYSQL_URL` and split MySQL variables are supported.
- Production authentication is fail-closed.
- `railway.json` uses Dockerfile build.
- `npm run migrate:runtime` runs before deployment.
- migrations are SHA-256 ledgered and idempotent.
- `/ready` is the deployment health gate.
- MySQL stores runtime/provenance only.
- ChatGPT Library content remains transient.

## Actual deployment status

The Railway plugin is installed/connected on the user's account, but this chat runtime has not exposed Railway action tools yet. No reconnect is required. Actual Railway project/service creation is therefore not claimed as complete.

The frozen RC2 is ready for the first Railway action-capable turn.
