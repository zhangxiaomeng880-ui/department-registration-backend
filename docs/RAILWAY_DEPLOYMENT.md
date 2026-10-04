# AI Native Runtime — Railway Deployment Contract

## Target topology

Railway Project
- Runtime service: GitHub repo + root Dockerfile
- MySQL service: Railway MySQL template
- Private service-to-service database connection
- Runtime public domain optional; API always protected by Bearer token

## Runtime source

Repository:
`zhangxiaomeng880-ui/department-registration-backend`

Release source must be a frozen Railway release candidate branch, not the moving feature branch.

Railway automatically uses the root `Dockerfile`. `railway.json` is the deployment configuration source.

## Runtime variables

Required:

```text
MYSQL_URL=${{MySQL.MYSQL_URL}}
RUNTIME_API_TOKEN=<server-side random secret>
```

Optional model provider variables:

```text
OPENAI_API_KEY=<server-side secret>
OPENAI_MODEL=<supported model id>
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_MS=120000
```

Do not expose either `RUNTIME_API_TOKEN` or `OPENAI_API_KEY` to browser code.

No `PORT` value should be hardcoded. Railway injects `PORT` and the Runtime listens to it automatically.

## Database boundary

Use the private `MYSQL_URL` reference from the Railway MySQL service.

The application accepts:
- `MYSQL_URL` (Railway preferred)
- `DATABASE_URL`
- Railway split MySQL variables
- legacy `DB_*` variables

Do not enable a public TCP proxy for MySQL unless an explicit operational need is approved.

## Deployment gate

`railway.json` requires:

1. Dockerfile build.
2. `npm run migrate:runtime` as pre-deploy migration.
3. `npm run start` as the Runtime command.
4. `/ready` as deployment healthcheck.
5. On-failure restart policy.

Production Runtime authentication is fail-closed:
- In `NODE_ENV=production`, authentication is required by default.
- If `RUNTIME_API_TOKEN` is absent, `/ready` returns not-ready and Railway must not promote the deployment.

## Migration behavior

`scripts/migrate-runtime.mjs`:
- applies every SQL migration exactly once;
- records file name and SHA-256 in `schema_migrations`;
- skips unchanged migrations on redeploy;
- fails if an already-applied migration file was modified;
- stores schema/runtime metadata only, never ChatGPT Library body.

## Expected readiness

Runtime may return:

- `ready`: database + auth + model provider configured.
- `degraded`: database + auth ready, model provider not configured.
- `not_ready`: database or required Runtime auth unavailable.

A `degraded` deployment is valid for Runtime core deployment while live model-provider secret injection remains externally blocked.

## Knowledge boundary

- ChatGPT Library: canonical project body.
- Context Bridge: transient memory-only payload.
- MySQL: Runtime state, provenance, evidence, checkpoints.
- Git: system code, policies, schema and deployment definition.

Project body must not be copied into Git or MySQL.

## Post-deploy acceptance

Required evidence:
- Railway deployment active.
- `/ready` returns HTTP 200.
- database.ready = true.
- runtimeAuth.required = true.
- runtimeAuth.ready = true.
- unauthorized Runtime API request returns 401.
- authorized project creation succeeds.
- migrations ledger contains the frozen migration set.
- Context Bridge body remains non-persistent.
