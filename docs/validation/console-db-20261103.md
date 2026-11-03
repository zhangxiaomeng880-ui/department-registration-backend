# Console database integration — 2026-11-03

Result: PASS for bounded HTTP/BFF/database smoke validation.

- Run: https://github.com/zhangxiaomeng880-ui/department-registration-backend/actions/runs/41620875467
- Tested commit: 9b3e1f7276c498a93a29693ec52e87b027f51a24
- Backend baseline: 923ea585dae82093308dc22d1250a9363ff9dc99
- Console BFF baseline: refactor-console subtree at 61cafb4604dc2cd051912377c625f44b33508bb0
- Environment: ephemeral GitHub Actions Ubuntu, Node 22, MySQL 8.0.46. No deployment, staging/production mutation, repository merge, real credentials or paid model calls.

## Verified

80 clean database migrations; repeat migration applied 0/skipped 80. Backend contract tests 31/31. Runtime health and DB readiness HTTP 200; unauthenticated Runtime/BFF project access HTTP 401; authenticated synthetic project creation HTTP 201 and direct SQL confirms stored row. Console login, authorized workspace/project list, password change, owner session after BFF restart and new-password login after restart HTTP 200.

## Boundaries

Original sandbox could not run MySQL because Unix sockets are prohibited, so verification moved to isolated CI. First smoke failed because its project-list request omitted workspaceId; corrected the test request. Second smoke hit a stale client connection after a deliberate server restart; fresh client connections fixed the harness. Product authentication restrictions were not weakened.

Model is unconfigured and /ready returns degraded; pricing catalog import skipped because no model is registered. No actual AI execution, S3 download, browser visual QA, complete RBAC matrix, full module acceptance or production release is claimed. Database/container are destroyed after CI; this is not an always-on accessible backend.
