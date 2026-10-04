# AI Native Runtime v2.1.0

Release date: 2026-10-04

## Status

**PRODUCTION LIVE**

v2.1.0 promotes the exact RC1 runtime commit already validated in isolated Railway staging:

- Runtime commit: `7b0d0f152395e39f4bdc5ea48217c4a24b7a284f`
- Production deployment: `ebb07381-56c5-4bab-85ef-59de1a13358f`
- Production branch source: `release/ai-native-runtime-v2.1-rc1`

## Included milestones

- M21.1 Observable Runtime — PASS
- M21.2 Policy Router v2 — PASS
- M21.3 Cost Ledger — PASS
- M21.4 Release Promotion Gate — PASS

## Production verification

- Railway Runtime: SUCCESS / Online
- MySQL Runtime: SUCCESS / Online
- Runtime migrations: `applied=3 skipped=4 total=7`
- Newly applied migrations:
  - `004_runtime_observability.sql`
  - `005_policy_router_v2.sql`
  - `006_cost_ledger.sql`
- `/ready`: HTTP 200, status `ready`
- Database readiness: PASS
- Runtime auth readiness: PASS
- Model provider configured: PASS
- Context Bridge: `EPHEMERAL_MEMORY_ONLY`, persisted=false
- Unauthorized Runtime API call: HTTP 401

The exact RC1 SHA previously passed isolated Railway staging with live OpenAI Responses invocation, structured output, Policy Router v2, Observability, Cost Ledger, Budget Policy, Gate/QA/Checkpoint, and no private source-body persistence/exposure.

After production promotion, an authorized synthetic production smoke was also executed successfully against the live Runtime. It confirmed OpenAI Responses invocation with `gpt-6-luna`, structured output, Gate/QA/Checkpoint creation, correlation-consistent Observability, readable Provider Registry, Cost Summary behavior, and no private source-body persistence or Observability exposure. Production pricing metadata is intentionally not hardcoded, so executions without an imported price version correctly report `UNKNOWN` cost rather than a fabricated zero.

## Product capabilities

### Observable Runtime

Correlation IDs now connect run, task, route, tool, Gate, QA evidence, checkpoints and usage evidence. Provider/model latency, token usage and machine-readable errors are inspectable without exposing private source bodies.

### Policy Router v2

Provider/model registry and health-aware deterministic routing support:

- QUALITY_FIRST
- COST_FIRST
- LATENCY_FIRST
- FALLBACK_ONLY

No allowed route fails closed. Unsupported adapters fail explicitly; silent provider substitution is forbidden.

### Cost Ledger

Execution usage supports immutable price-version attribution, estimated cost calculation, project/run/task/stage/provider/model rollups, Budget Policy hooks and explicit UNKNOWN/HOLD behavior when pricing metadata is missing.

This remains accounting metadata only. v2.1.0 does not introduce payment, checkout, subscription or charging workflows.

## Truth boundary

A second real external model provider is not claimed as live. Multi-provider routing infrastructure is production-capable, while the current production model provider remains OpenAI Responses.

No synthetic acceptance price is presented as current official provider pricing.

## Rollback

The prior v2.0 production target remains captured:

- Runtime commit: `ca159922a609639b72656dbf7424777db1d6d00a`
- Deployment: `31e58eab-78a3-467b-b994-f73d873d5f18`

## Release decision

**V2.1.0 APPROVED AND LIVE IN PRODUCTION.**
