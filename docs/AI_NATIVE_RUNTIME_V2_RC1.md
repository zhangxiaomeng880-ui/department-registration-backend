# AI Native Runtime v2.0 RC1

Frozen release candidate:

- Branch: `release/ai-native-runtime-v2.0-rc1`
- Commit: `f11deb61cf6013adfe84fd1b032f63904aab25e3`
- Router: `router-p86-v1`
- Workflow: `context-orchestrator-v1`

## Validation evidence

All four required workflows passed on the exact frozen commit:

- Backend Validation #116 — run `37182998655`
- Runtime Orchestrator Validation #24 — run `37182998665`
- Runtime Deployment Validation #10 — run `37182998699`
- VPS Deployment Scripts Validation #1 — run `37182998698`

## Deployment rule

Real VPS deployment must use:

```bash
bash scripts/deploy-runtime-rc.sh
bash scripts/verify-runtime-vps.sh
```

Do not deploy the moving feature branch directly.

## Remaining external gates

1. Real authorized VPS terminal execution is still pending.
2. Real OpenAI Live Provider secret injection remains unverified. This does not invalidate Runtime/MySQL/Context Bridge/Orchestrator deployment; readiness is intentionally reported as `degraded` until the model provider is configured in the runtime environment.
3. The user must not be asked to recreate or reconfigure the same OpenAI API key again.

## Knowledge boundary

ChatGPT Library remains the canonical project-body source. Git contains system code/rules/config; MySQL contains runtime/provenance/evidence. Transient Library body is consumed through the in-memory Context Bridge and is not persisted to Git or MySQL.
