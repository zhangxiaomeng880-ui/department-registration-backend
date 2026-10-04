# AI Native Runtime v2.1 Productization Plan

Status: ACTIVE PLANNING
Base release: v2.0.0
Base branch head: `52fd6795e876091b8266d8b583ec7507c0a4df22`
Runtime production code baseline: `ca159922a609639b72656dbf7424777db1d6d00a`

## Goal

Move AI Native Runtime from a validated production runtime foundation into an operable product platform without weakening the v2.0 production evidence boundary.

v2.1 focuses on four productization capabilities:

1. production observability
2. multi-model/provider routing
3. cost and usage accounting
4. release promotion automation

## Non-goals

The following remain outside v2.1 unless explicitly promoted through a new Gate:

- end-user SaaS billing/checkout
- organization-level commercial subscriptions
- marketplace packaging
- full customer tenancy/enterprise RBAC
- private creative source-body persistence
- replacing ChatGPT Library as the canonical private knowledge source

## Execution order

### P0 — Observability foundation

Purpose: make every model/runtime decision inspectable before adding routing complexity.

Deliverables:

- runtime request correlation ID across run/task/route/tool/gate/QA/checkpoint
- latency fields for DB, provider, router, orchestration, and total runtime
- provider/model success and failure metrics
- token usage aggregation by run, task, provider, model, and project
- structured error classification
- operational health summary endpoint or query surface
- no source-body logging

Gate: `G21-OBSERVABILITY`

PASS requires:

- 100% synthetic acceptance runs have traceable run → task → route → tool → gate/QA/checkpoint linkage
- provider latency and token usage are recorded
- failures surface machine-readable error category
- private context text is absent from logs and durable telemetry

### P1 — Multi-provider routing

Purpose: evolve Router + Policy from one production provider into policy-driven provider/model selection.

Deliverables:

- provider registry
- model capability registry
- route policy inputs: task type, quality tier, latency tier, cost tier, provider health
- deterministic fallback chain
- explicit provider/model decision evidence
- fail-closed behavior when no allowed route exists

Initial routing dimensions:

- quality-first
- cost-first
- latency-first
- fallback-only

Gate: `G21-MULTI-PROVIDER`

PASS requires:

- route decision is deterministic for the same policy inputs
- fallback is evidence-recorded
- no silent provider substitution
- provider outage can fail over without losing checkpoint/provenance
- current OpenAI Responses path remains backward-compatible

### P1 — Cost and usage accounting

Purpose: make AI Native execution financially measurable before SaaS billing.

Deliverables:

- per tool execution input/output token accounting
- provider/model price metadata with version/effective date
- estimated execution cost persisted as metadata
- aggregation by project/run/task/stage/provider/model
- budget threshold policy hooks
- cost evidence in Gate/QA where relevant

Gate: `G21-COST-ACCOUNTING`

PASS requires:

- synthetic runs reconcile raw token usage to calculated cost
- pricing changes are versioned rather than overwriting history
- no billing charge/payment workflow is introduced
- missing price metadata produces explicit UNKNOWN/HOLD rather than fabricated cost

### P2 — Release promotion automation

Purpose: convert the manual RC evidence pattern proven in v2.0 into a repeatable release workflow.

Deliverables:

- release-candidate manifest generator
- evidence collector for CI + Railway + provider smoke tests
- immutable release evidence artifact
- automatic release-readiness verdict
- explicit manual approval boundary before production promotion
- rollback target recorded before promotion

Gate: `G21-RELEASE-PROMOTION`

PASS requires:

- promotion cannot occur with failed required evidence
- release manifest identifies exact runtime SHA and deployment IDs
- rollback target is present
- secret values never enter evidence artifacts
- historical RC evidence remains immutable

## Data model additions

Candidate additive tables/fields only; v2.0 tables must remain backward-compatible.

- `provider_registry`
- `model_registry`
- `provider_health_events`
- `usage_ledger`
- `pricing_versions`
- `cost_rollups`
- `release_evidence`

Candidate additive fields:

- correlation_id
- latency_ms
- provider_key
- model_key
- price_version
- estimated_cost
- error_category

## Compatibility rules

- no destructive migration in 2.1 initial milestones
- existing v2.0 Runtime API contracts remain valid
- `OPENAI_API_KEY` + `OPENAI_MODEL` single-provider mode must continue to work
- production source body persistence remains forbidden
- Context Bridge remains ephemeral/consume-once by default
- every new automation action must have explicit evidence state

## Milestones

### M21.1 — Observable Runtime

Build telemetry schema, correlation IDs, latency/error/token accounting, and validation fixtures.

Exit: `G21-OBSERVABILITY = PASS`.

### M21.2 — Policy Router v2

Add provider/model registry, policy dimensions, fallback chain, and route evidence.

Exit: `G21-MULTI-PROVIDER = PASS`.

### M21.3 — Cost Ledger

Add versioned pricing, token-to-cost calculation, rollups, and budget hooks.

Exit: `G21-COST-ACCOUNTING = PASS`.

### M21.4 — Release Automation

Generate evidence manifests automatically and enforce promotion Gate.

Exit: `G21-RELEASE-PROMOTION = PASS`.

## First implementation slice

Start with M21.1 only.

Initial engineering tasks:

1. add correlation ID propagation
2. add latency/error metadata to route/tool execution records
3. add usage ledger migration
4. aggregate provider/model token usage
5. add synthetic observability acceptance test
6. add GitHub Actions validation for G21-OBSERVABILITY

Do not begin multi-provider production routing until M21.1 passes.

## Definition of done for v2.1

v2.1 is release-ready only when all four Gates pass on a real Railway environment, the v2.0 single-provider path remains compatible, and production evidence proves that observability/routing/cost/release automation operate without persisting private source bodies.
