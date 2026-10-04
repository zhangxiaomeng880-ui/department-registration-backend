# AI Native Runtime v2.1 Productization Plan

Status: PLANNED
Base release: v2.0.0
Base commit: `52fd6795e876091b8266d8b583ec7507c0a4df22`
Working branch: `feat/ai-native-runtime-v2.1-productization`

## 1. Goal

v2.1 turns the v2.0 production Runtime from a proven deployment into an operable, diagnosable, reusable product platform.

The success criterion is not "more features". It is that Runtime decisions, failures, model execution, cost/latency signals, regressions, and releases become observable and controllable without relying on chat history or manual reconstruction.

## 2. Non-goals

v2.1 does not introduce the commercial SaaS layer.

The following remain outside v2.1 unless a new scope decision is made:

- customer billing and monetization
- subscription/package design
- tenant charging rules
- public SaaS onboarding
- broad marketplace/provider catalogue
- private creative source-body persistence

Those belong to the later 3.0 commercialization track.

## 3. P0 workstreams

### P0-1 Runtime Observability

Add first-class operational visibility for run/task/provider execution.

Required outputs:

- run/task/provider latency
- input/output token counts
- provider/model attribution
- route decision and policy result
- retry/failure category
- Gate/QA/checkpoint linkage
- execution status timeline
- production-safe metrics/inspection endpoints

Hard gate:

A failed or slow execution must be explainable from persisted runtime evidence without reading chat history.

### P0-2 Provider Router + Policy

Evolve the current single live OpenAI provider into a provider abstraction controlled by Router + Policy.

Required outputs:

- provider adapter contract
- model capability metadata
- route criteria for quality / latency / cost / reliability
- explicit fallback policy
- provider health state
- provider execution provenance
- fail-closed behavior when no allowed route exists

Hard gate:

Every model invocation must have a recorded route decision and provider/model provenance. Silent fallback is forbidden.

### P0-3 Eval + Replay

Add repeatable regression evaluation for Runtime behavior.

Required outputs:

- synthetic golden fixtures
- production-safe replay input format
- structured-output validation
- evidence/provenance validation
- router decision assertions
- regression score/report
- no private source body in public fixtures

Hard gate:

A Runtime change cannot become a release candidate unless its eval suite is reproducible and passes against the intended release SHA.

### P0-4 Evidence-based Release Promotion

Turn the current manual RC evidence process into a repeatable release workflow.

Required outputs:

- immutable RC manifest schema
- production deployment evidence capture
- CI status capture
- provider live smoke evidence
- release readiness decision
- rollback target metadata
- release promotion checklist

Hard gate:

"DEPLOYED", "VERIFIED", "PASS", and "RELEASE READY" may only be declared from recorded evidence tied to exact code/deployment identifiers.

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

Add retrieval quality signals without changing the body-persistence boundary.

Track:

- source status
- retrieval rank
- selected/not-selected
- context fingerprint
- evidence resolution
- stale/HISTORICAL rejection
- retrieval miss / low-confidence reasons

### P1-3 Cost Accounting Foundation

Record provider usage facts needed for later 3.0 billing:

- token input/output
- model/provider
- execution duration
- provider response id
- estimated provider cost where safely derivable

This is internal cost observability only. Customer charging remains 3.0.

## 5. Release gates

v2.1 cannot enter RC until all P0 gates pass.

Minimum RC evidence:

1. CI passes on exact candidate SHA.
2. Railway deployment succeeds.
3. Runtime readiness succeeds.
4. MySQL migrations are idempotent.
5. Auth remains fail-closed.
6. Provider Router decisions are recorded.
7. Eval/Replay suite passes.
8. Production-safe provider smoke succeeds.
9. Gate/QA/Checkpoint evidence is persisted.
10. Private source body is absent from public Git and Runtime persistence.
11. Rollback target is recorded.

## 6. Execution order

Recommended implementation order:

1. Runtime Observability
2. Eval + Replay
3. Provider Router + Policy
4. Evidence-based Release Promotion
5. Operator Inspection Surface
6. Retrieval quality improvements
7. Cost accounting foundation

Reason: observability and eval must exist before increasing routing complexity.

## 7. Architecture constraints carried forward from v2.0

- ChatGPT Library remains canonical source body for private creative content.
- Git stores code, rules, config, and version truth.
- MySQL stores runtime/provenance/checkpoint/Gate/QA/Audit metadata and evidence only.
- Context Bridge transports source text ephemerally in memory.
- Source body persistence remains forbidden by default.
- CURRENT/FACT/RULE/FINAL remain default allowed source states.
- Gate truth must be evidence-backed.
- Stage snapshots are immutable.
- Retry/resume must start from persisted runtime state, not conversational memory.

## 8. Definition of done

v2.1 is done when the platform can answer, from recorded system evidence alone:

- what ran
- why it was routed that way
- which provider/model executed it
- what it cost in tokens/time
- what failed and why
- whether retry/fallback occurred
- what evidence justified PASS/FAIL
- what checkpoint can resume execution
- whether a candidate is safe to promote

At that point the Runtime is not only functional; it is operable and productizable.
