# AI Native Runtime v2.1 Productization Plan

Status: ACTIVE
Base release: v2.0.0
Base release head: `52fd6795e876091b8266d8b583ec7507c0a4df22`
Runtime production code baseline: `ca159922a609639b72656dbf7424777db1d6d00a`
Working branch: `feat/ai-native-runtime-v2.1-productization`

## 1. Goal

v2.1 turns the v2.0 production Runtime from a proven deployment into an operable, diagnosable, reusable product platform.

The success criterion is not "more features". Runtime decisions, failures, model execution, latency/cost signals, regressions, and releases must become observable and controllable without relying on chat history or manual reconstruction.

## 2. Non-goals

v2.1 does not introduce the commercial SaaS layer.

The following remain outside v2.1 unless explicitly promoted through a new Gate:

- customer billing and monetization
- subscription/package design
- tenant charging rules
- public SaaS onboarding
- organization-level commercial subscriptions
- marketplace packaging
- full enterprise tenancy/RBAC
- private creative source-body persistence
- replacing ChatGPT Library as canonical private knowledge source

These belong to the later 3.0 commercialization track.

## 3. P0 workstreams

### P0-1 Runtime Observability

Purpose: make every Runtime/model decision inspectable before adding routing complexity.

Required outputs:

- correlation ID across run/task/route/tool/Gate/QA/checkpoint
- run/task/provider/router/orchestrator latency
- input/output token counts
- provider/model attribution
- route decision and policy result
- retry/failure category
- Gate/QA/checkpoint linkage
- execution status timeline
- production-safe health/inspection surface
- no source-body logging

Candidate additive fields:

- `correlation_id`
- `latency_ms`
- `provider_key`
- `model_key`
- `error_category`

Gate: `G21-OBSERVABILITY`

PASS requires:

- synthetic acceptance runs have traceable run → task → route → tool → Gate/QA/checkpoint linkage
- provider latency and token usage are recorded
- failures surface a machine-readable category
- private context text is absent from logs and durable telemetry
- a failed or slow execution is explainable from persisted Runtime evidence alone

### P0-2 Eval + Replay

Purpose: make Runtime changes reproducibly testable before increasing routing complexity.

Required outputs:

- synthetic golden fixtures
- production-safe replay input format
- structured-output validation
- evidence/provenance validation
- router decision assertions
- regression score/report
- no private source body in public fixtures

Gate: `G21-EVAL-REPLAY`

PASS requires:

- identical fixture + policy inputs produce reproducible assertions
- evidence references resolve to supplied synthetic context
- structured-output contract failures are explicit
- candidate SHA is recorded in the report
- a release candidate cannot pass without its eval suite passing

### P0-3 Provider Router + Policy

Purpose: evolve the current single live OpenAI provider into policy-driven provider/model selection.

Required outputs:

- provider registry
- model/capability registry
- provider adapter contract
- policy dimensions for task type, quality, latency, cost, reliability, provider health
- explicit deterministic fallback chain
- provider health state
- provider execution provenance
- fail-closed behavior when no allowed route exists

Candidate additive tables:

- `provider_registry`
- `model_registry`
- `provider_health_events`

Gate: `G21-PROVIDER-ROUTER`

PASS requires:

- route decision is deterministic for the same policy inputs
- every invocation records route/provider/model provenance
- fallback is evidence-recorded
- no silent provider substitution
- no allowed route fails closed
- current OpenAI Responses path remains backward-compatible

### P0-4 Evidence-based Release Promotion

Purpose: convert the manual RC evidence pattern proven in v2.0 into a repeatable promotion workflow.

Required outputs:

- immutable RC manifest schema
- CI evidence capture
- production deployment evidence capture
- provider-live smoke evidence
- automatic release-readiness verdict
- rollback target metadata
- explicit manual approval boundary before production promotion

Candidate additive table:

- `release_evidence`

Gate: `G21-RELEASE-PROMOTION`

PASS requires:

- promotion cannot occur with failed required evidence
- manifest identifies exact Runtime SHA and deployment IDs
- rollback target is present
- secret values never enter evidence artifacts
- historical RC evidence remains immutable
- DEPLOYED / VERIFIED / PASS / RELEASE READY are emitted only from recorded evidence

## 4. P1 workstreams

### P1-1 Operator Inspection Surface

Provide a minimal operator/admin view for:

- runs
- tasks
- routes
- tool/provider executions
- Gate results
- QA evidence
- checkpoints
- failures and retry state

This is an operational surface, not a full SaaS product UI.

### P1-2 Knowledge Retrieval Quality

Track:

- source status
- retrieval rank
- selected/not-selected
- context fingerprint
- evidence resolution
- stale/HISTORICAL rejection
- retrieval miss / low-confidence reasons

The source-body persistence boundary does not change.

### P1-3 Internal Cost Accounting Foundation

Purpose: make AI Native execution financially measurable before SaaS billing.

Required outputs:

- token input/output by run/task/stage/provider/model
- versioned provider/model price metadata
- estimated execution cost as metadata
- execution duration
- provider response ID
- project/run/task/stage rollups
- budget threshold policy hooks

Candidate additive tables:

- `usage_ledger`
- `pricing_versions`
- `cost_rollups`

Gate: `G21-COST-FOUNDATION`

PASS requires:

- synthetic usage reconciles token counts to calculated cost
- pricing changes are versioned rather than overwriting history
- missing price metadata yields UNKNOWN/HOLD instead of fabricated cost
- no customer charge/payment flow is introduced

## 5. Milestones and execution order

### M21.1 — Observable Runtime

Implement correlation IDs, latency/error metadata, token accounting, inspection queries/endpoints, and synthetic observability acceptance tests.

Exit: `G21-OBSERVABILITY = PASS`.

### M21.2 — Eval + Replay

Build golden fixtures, replay format, structured/evidence assertions, and regression reporting.

Exit: `G21-EVAL-REPLAY = PASS`.

### M21.3 — Policy Router v2

Add provider/model registry, provider adapter contract, policy dimensions, health/fallback behavior, and route evidence.

Exit: `G21-PROVIDER-ROUTER = PASS`.

### M21.4 — Release Promotion Automation

Generate immutable evidence manifests and enforce promotion Gate with rollback metadata.

Exit: `G21-RELEASE-PROMOTION = PASS`.

### M21.5 — Operator/Productability Layer

Add operator inspection surface, retrieval-quality signals, and internal cost accounting foundation.

Exit: P1 acceptance gates PASS.

Order is deliberate: observability and eval must exist before provider routing complexity increases.

## 6. Compatibility rules

- no destructive migration in the initial 2.1 milestones
- existing v2.0 Runtime API contracts remain valid unless explicitly versioned
- `OPENAI_API_KEY` + `OPENAI_MODEL` single-provider mode remains supported
- production source-body persistence remains forbidden
- Context Bridge remains ephemeral/consume-once by default
- every new automation action has explicit evidence state
- Gate truth remains evidence-backed
- stage snapshots remain immutable
- retry/resume starts from persisted Runtime state, not conversational memory

## 7. Architecture constraints carried forward from v2.0

- ChatGPT Library remains canonical source body for private creative content.
- Git stores code, rules, config, and version truth.
- MySQL stores runtime/provenance/checkpoint/Gate/QA/Audit metadata and evidence only.
- Context Bridge transports source text ephemerally in memory.
- CURRENT/FACT/RULE/FINAL remain default allowed source states.
- HISTORICAL remains rejected by default execution unless policy explicitly allows it.

## 8. RC gate

v2.1 cannot enter RC until all P0 gates pass.

Minimum RC evidence:

1. CI passes on the exact candidate SHA.
2. Railway deployment succeeds.
3. Runtime readiness succeeds.
4. MySQL migrations are idempotent.
5. Auth remains fail-closed.
6. Observability Gate passes.
7. Eval/Replay Gate passes.
8. Provider Router decisions are recorded and deterministic.
9. Production-safe provider smoke succeeds.
10. Gate/QA/Checkpoint evidence is persisted.
11. Private source body is absent from public Git and Runtime persistence.
12. Rollback target is recorded.
13. Release-promotion Gate passes.

## 9. First implementation slice

Start with M21.1 only.

Initial engineering tasks:

1. add correlation ID propagation
2. add latency/error metadata to route/tool execution records
3. aggregate provider/model token usage
4. expose a production-safe observability query/endpoint
5. add synthetic observability acceptance test
6. add CI validation for `G21-OBSERVABILITY`

Do not begin multi-provider production routing until M21.1 and M21.2 pass.

## 10. Definition of done

v2.1 is release-ready when the platform can answer, from recorded system evidence alone:

- what ran
- why it was routed that way
- which provider/model executed it
- what it consumed in tokens/time
- what failed and why
- whether retry/fallback occurred
- what evidence justified PASS/FAIL
- what checkpoint can resume execution
- whether a candidate is safe to promote

At that point the Runtime is not only functional; it is operable and productizable.
