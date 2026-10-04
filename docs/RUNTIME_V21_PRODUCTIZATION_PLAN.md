# AI Native Runtime v2.1 Productization Plan

Base release: v2.0.0  
Working branch: `feat/ai-native-runtime-v2.1-productization`

## Current status

| Milestone | Gate | Status | Evidence |
| --- | --- | --- | --- |
| M21.1 Observable Runtime | G21-OBSERVABILITY | PASS / FROZEN | `release/runtime-v2.1-m21.1-observability.json` |
| M21.2 Policy Router v2 | G21-MULTI-PROVIDER | PASS / FROZEN | `release/runtime-v2.1-m21.2-policy-router.json` |
| M21.3 Cost Ledger | G21-COST-ACCOUNTING | PASS / FROZEN | `release/runtime-v2.1-m21.3-cost-ledger.json` |
| M21.4 Release Promotion | G21-RELEASE-PROMOTION | PASS / FROZEN | `release/runtime-v2.1-m21.4-release-promotion.json` |

## M21.1 — Observable Runtime

Completed:

- correlation ID propagation across run/task/route/tool/gate/QA/checkpoint
- provider/router latency and machine-readable error categories
- provider/model token usage ledger
- run-level token aggregation
- safe observability read surface
- no private source-body exposure

## M21.2 — Policy Router v2

Completed:

- provider registry
- model registry
- provider health events
- deterministic policy modes:
  - QUALITY_FIRST
  - COST_FIRST
  - LATENCY_FIRST
  - FALLBACK_ONLY
- provider health-aware selection
- deterministic fallback chain
- explicit selected provider/model/adapter evidence
- provider decision visible through observability
- no route available => BLOCK
- unsupported provider adapter => explicit FAIL, no silent substitution
- OpenAI Responses remains backward compatible
- policy-selected OpenAI model override

Truth boundary:

M21.2 proves the multi-provider routing infrastructure and failover semantics using CI fixtures and a mock Responses-compatible provider. It does **not** claim that a second real external provider is live in Railway production.

## M21.3 — Cost Ledger

Status: **PASS / EVIDENCE FROZEN** (`release/runtime-v2.1-m21.3-cost-ledger.json`)

Completed:

- versioned provider/model pricing metadata
- token usage to estimated execution cost conversion
- immutable price-version linkage per execution
- project/run/task/stage/provider/model rollups
- budget threshold policy hooks
- UNKNOWN/HOLD behavior for missing pricing
- currency mismatch and mixed-currency HOLD behavior
- no payment, charging, subscription or checkout behavior
- pricing/budget metadata secret guard

Exit Gate: `G21-COST-ACCOUNTING = PASS`

## M21.4 — Release Promotion

Status: **PASS / EVIDENCE FROZEN** (`release/runtime-v2.1-m21.4-release-promotion.json`)

Completed:

- automated RC readiness manifest
- M21.1–M21.3 evidence requirements
- required CI evidence checks
- exact candidate SHA validation
- production rollback target capture
- staging deployment/commit/readiness/provider-smoke requirements
- secret leakage detection
- explicit manual production approval boundary
- automatic production promotion forbidden by Gate

Current RC:

- candidate: `ai-native-runtime-v2.1-rc1`
- immutable RC branch: `release/ai-native-runtime-v2.1-rc1`
- candidate code SHA: `7b0d0f152395e39f4bdc5ea48217c4a24b7a284f`
- isolated Railway staging: **PASS**
- staging evidence: `release/runtime-v2.1-rc1-staging.json`
- readiness: **AWAITING_MANUAL_APPROVAL**
- remaining blocker: `MANUAL_APPROVAL_REQUIRED`
- current production remains v2.0 and SUCCESS
- rollback target is captured in the RC readiness manifest

Next release action:

An explicit release-owner approval is required before any production promotion. Production promotion remains manual; it must deploy the exact RC SHA and preserve the captured v2.0 rollback target.

## Release rule

v2.1 is not release-ready until all four gates pass and a real Railway validation cycle confirms backward compatibility with the frozen v2.0 production path.
