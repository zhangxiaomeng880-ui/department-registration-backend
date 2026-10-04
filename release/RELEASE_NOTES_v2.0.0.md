# AI Native Runtime v2.0.0

Release date: 2026-10-04

## Status

**RELEASE READY / PRODUCTION LIVE**

This release freezes the AI Native 2.0 Runtime production baseline after RC4 completed live Railway, MySQL, authentication, provenance, checkpoint, and OpenAI Responses provider validation.

## Production baseline

- Runtime platform: Railway
- Runtime service: `runtime`
- Production Runtime code SHA: `ca159922a609639b72656dbf7424777db1d6d00a`
- Production deployment: `31e58eab-78a3-467b-b994-f73d873d5f18`
- Database service: `mysql-runtime`
- Database deployment: `ef5f63ce-0c9e-499b-95a5-ddd670c7e539`
- Persistent database volume: `mysql-runtime-data`
- Readiness endpoint: `/ready`, HTTP 200 observed
- Model provider: OpenAI Responses API
- Production model: `gpt-6-luna`

## Validated capabilities

- Runtime persistence and production migrations
- Production auth configured fail-closed
- Router + Policy execution and recorded route evidence
- Ephemeral Context Bridge with no source-body persistence
- Gate and QA Evidence recording
- Checkpoint creation and resumability metadata
- OpenAI Responses provider live invocation
- Strict structured JSON response contract
- Provider provenance recorded without persisting private source text
- MySQL remains private with no public TCP proxy

## Production evidence

The production-live RC4 evidence is frozen in:

`release/runtime-v2.0-rc4-production-live.json`

The formal production baseline is declared in:

`release/runtime-v2.0.0-production-baseline.json`

RC1, RC2, RC3, and RC4 remain immutable historical evidence.

## CI baseline

The production Runtime code SHA `ca159922a609639b72656dbf7424777db1d6d00a` passed:

- Release Candidate Validation
- Railway Runtime Compatibility
- Backend Validation
- Runtime Deployment Validation
- VPS Deployment Scripts Validation
- Runtime Orchestrator Validation

## Security and data boundary

Private creative source bodies are not stored in public Git or Runtime persistence tables. Runtime persists execution metadata, provenance, Gate/QA evidence, checkpoints, and related operational state. Context source text is transient and consume-once.

Secrets are configured in the deployment environment and are not committed to the repository.

## v2.0 release boundary

v2.0 is the stable Runtime foundation. It does not include the planned v2.1+/3.0 commercial layer.

Deferred work includes:

- billing and cost accounting
- multi-provider production routing
- broader production observability
- automated release promotion
- PaaS-to-SaaS commercialization features

These items are explicitly outside the v2.0 release baseline and must not be backported into this frozen release without a new release candidate and evidence cycle.

## Release decision

All required v2.0 production gates are PASS.

**Decision: APPROVED FOR v2.0.0 RELEASE.**
