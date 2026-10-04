# AI Native Runtime 2.1 Backlog

This backlog is intentionally separated from the v2.0.0 production baseline. Items here are not requirements for the v2.0.0 PASS.

## P0 — Production hardening

- Add an automated production-safe synthetic provider smoke test that can run without manually exposing Runtime secrets.
- Add provider error classification for timeout, rate limit, malformed structured output, authentication failure, and upstream service failure.
- Add bounded retry / backoff and circuit-breaker policy for model-provider calls.
- Add database backup and restore drill documentation with recovery evidence.
- Add secret-rotation runbook for `OPENAI_API_KEY` and `RUNTIME_API_TOKEN`.
- Add automated release-evidence generation so production deployment IDs, health checks, CI runs, and provider smoke results are captured without manual manifest editing.

## P1 — Eval, routing, and observability

- Build a reusable Eval dataset and Gate thresholds for Script / AIGC workflow tasks.
- Extend Router + Policy to support explicit multi-model routing by task quality, latency, and cost.
- Record standardized provider latency, input/output token usage, retry count, and estimated cost per execution.
- Add tracing / correlation IDs across run → task → route → provider → Gate → QA → checkpoint.
- Add dashboards for execution success rate, first-pass rate, rework rate, manual intervention, token cost, and latency.
- Add retrieval-quality metrics and provenance checks for RAG / knowledge-context selection.

## P1 — Reliability and workflow recovery

- Formalize task retry, pause, resume, rollback, and dependency invalidation behavior.
- Add deterministic recovery tests from checkpoints after process restart.
- Add stage-snapshot promotion rules and immutable Current-version semantics.
- Add idempotency tests for externally triggered Runtime actions.

## P2 — Platform evolution

- Package reusable workflow capabilities as SaaS-facing primitives.
- Add project-level quotas, usage metering, and cost accounting.
- Add capability registry / version compatibility policies for Agent, Skill, MCP, and model routes.
- Add user / project permission boundaries and production audit views.
- Prepare billing and tenant-isolation foundations for the 3.0 PaaS → SaaS direction.

## Deferred cleanup

- The detached legacy `mysql-data` volume is intentionally preserved for safety. Delete it only after an explicit retention decision and a separate destructive-action confirmation.
