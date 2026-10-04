# AI Native Runtime v2.1 Productization Plan

Base release: v2.0.0  
Working branch: `feat/ai-native-runtime-v2.1-productization`

## Current status

| Milestone | Gate | Status | Evidence |
| --- | --- | --- | --- |
| M21.1 Observable Runtime | G21-OBSERVABILITY | PASS / FROZEN | `release/runtime-v2.1-m21.1-observability.json` |
| M21.2 Policy Router v2 | G21-MULTI-PROVIDER | PASS / FROZEN | `release/runtime-v2.1-m21.2-policy-router.json` |
| M21.3 Cost Ledger | G21-COST-ACCOUNTING | NEXT | — |
| M21.4 Release Promotion | G21-RELEASE-PROMOTION | PLANNED | — |

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

Next implementation scope:

1. add versioned provider/model pricing metadata
2. convert token usage into estimated execution cost
3. persist price version with every calculated cost
4. aggregate cost by project/run/task/stage/provider/model
5. add budget threshold policy hooks
6. return UNKNOWN/HOLD when required price metadata is missing
7. keep payment, charging, subscription and checkout out of v2.1

Exit Gate: `G21-COST-ACCOUNTING = PASS`

Required acceptance:

- raw token usage reconciles to calculated estimated cost
- historical execution cost remains tied to the original price version
- updating a price never rewrites prior ledger history
- missing pricing cannot silently produce zero/fabricated cost
- private source text remains absent from pricing/cost records

## M21.4 — Release Promotion

After M21.3 only:

- automated RC evidence manifest
- CI + Railway + provider evidence collection
- release-readiness verdict
- manual production approval boundary
- rollback target captured before promotion

## Release rule

v2.1 is not release-ready until all four gates pass and a real Railway validation cycle confirms backward compatibility with the frozen v2.0 production path.
