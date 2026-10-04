# AI Native Runtime 2.0 — Release Notes

## Release status

AI Native Runtime 2.0 is production-live and has passed the final release gate.

The production Runtime is pinned to commit `ca159922a609639b72656dbf7424777db1d6d00a`. Release evidence is recorded separately so the production code SHA remains distinguishable from evidence-only commits.

## What is included

Runtime 2.0 provides a production persistence and orchestration layer for AI-native workflows:

- MySQL-backed projects, runs, tasks, checkpoints, stage snapshots, route executions, tool executions, Gate results, QA evidence, audit logs, and knowledge provenance metadata.
- Router + Policy execution with evidence recording.
- Ephemeral Context Bridge for transient source text; private source body is not persisted to Runtime storage.
- OpenAI Responses provider with strict structured-output validation.
- Runtime authentication with fail-closed production behavior.
- Checkpoint / resume foundations and immutable execution evidence.
- Railway production deployment with private MySQL networking and persistent database volume.

## Production verification

The following were verified against the real Railway production environment:

- Runtime deployment: SUCCESS.
- MySQL Runtime deployment: SUCCESS.
- Runtime readiness endpoint: HTTP 200.
- Database migrations: all 4 migrations applied / recognized.
- Unauthorized Runtime API request: HTTP 401.
- OpenAI Responses provider: real live invocation succeeded.
- Model used: `gpt-6-luna`.
- Provider smoke test: HTTP 200.
- Structured JSON contract: PASS.
- Gate result creation: PASS.
- QA evidence creation: PASS.
- Checkpoint creation: PASS.
- Source body persisted: false.

## CI evidence

The production Runtime commit passed:

- Release Candidate Validation.
- Railway Runtime Compatibility.
- Backend Validation.
- Runtime Deployment Validation.
- VPS Deployment Scripts Validation.
- Runtime Orchestrator Validation.

## Data and privacy boundary

ChatGPT Library remains the canonical source for private creative source material. Public Git contains code, rules, configuration, schemas, and release evidence only. MySQL stores runtime state and provenance metadata, not private story body text. Context Bridge payload bodies remain transient in memory.

## Release lineage

- RC1: initial release-candidate baseline.
- RC2: Railway compatibility candidate; real deployment exposed startup timing failure.
- RC3: startup retry fix; real Railway deployment passed.
- RC4: production-live OpenAI Provider verification and final runtime Gate passed.
- v2.0.0: formal production baseline.

## Next version

All new capability work after this baseline belongs to the 2.1 backlog. v2.0.0 should remain a frozen production reference unless a critical production hotfix is required.
