# AI Native 2.0 Runtime Persistence Schema V1.0

Status: DRAFT FOR IMPLEMENTATION  
Scope: MySQL runtime persistence only  
Out of scope: RAG indexing, UI redesign, new Agents, new Workflows

## 1. Source-of-truth split

- Git: runtime code, workflow definitions, router/policy rules, Agent/Skill configuration, formal knowledge source files.
- MySQL: runtime facts and execution state.
- RAG: retrieval index derived from Git knowledge; not the source of truth.

## 2. Runtime tables

1. `projects` — project identity and current runtime/knowledge pointers.
2. `runs` — one workflow/task execution session.
3. `tasks` — ordered executable units within a run.
4. `checkpoints` — resumable execution state written after critical operations.
5. `stage_snapshots` — immutable stage-level snapshots after Gate/QA/user confirmation.
6. `route_executions` — actual Router decisions and Agent/Skill/Tool selection.
7. `tool_executions` — actual MCP/tool/model calls, cost, duration, errors.
8. `gate_results` — PASS/BLOCK/HOLD decisions with criteria and evidence.
9. `qa_evidence` — QA evidence linked to run/task/gate.
10. `audit_logs` — append-only operational trace.

## 3. Required invariants

- A completed task must not be re-run on Resume unless its input, dependency, rule or version fingerprint changed.
- Checkpoint sequence is strictly increasing within one run.
- Stage Snapshot history is immutable.
- Only one Current Stage Snapshot may exist for a project + stage.
- PASS/BLOCK/HOLD must always carry evidence or a blocking reason.
- Runtime records must preserve the Git commit/version pointers used for execution.
- Unknown fields must be explicitly represented as pending/not-produced in application state instead of silently omitted where the execution contract requires them.

## 4. Resume contract

Resume must load the latest VALID checkpoint for the run, then verify:

- runtime commit
- workflow version
- router version
- knowledge commit
- dependency fingerprint
- project permissions/current state

If the fingerprint is unchanged, the runtime resumes from `resume_from_task_key`.
If changed, the affected task range is invalidated explicitly; the whole workflow must not restart by default.

## 5. Minimum acceptance for Step 1.1

PASS only when:

- migration executes successfully on MySQL 8.x;
- all tables and foreign keys are created;
- a Run can write a Task and Checkpoint;
- process restart can reload the latest Checkpoint;
- Stage Snapshot Current uniqueness is enforced;
- execution evidence can be queried by run_id.

Until these are executed against a real MySQL instance, status remains IMPLEMENTED / NOT VALIDATED.
