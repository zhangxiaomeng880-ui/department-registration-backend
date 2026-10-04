# AI Native 2.0 VPS Deployment Gate

Status: READY FOR REAL VPS EXECUTION

## What is already proven

- Runtime container image builds.
- MySQL 8 migrations apply.
- MySQL is not published to the host.
- Runtime binds only to `127.0.0.1:3100`.
- Runtime Bearer authentication rejects unauthorized calls.
- `/health` and `/ready` pass.
- Runtime restarts against the existing MySQL volume.
- Context Bridge remains memory-only.

## Files

- `scripts/preflight-runtime-vps.sh`
- `scripts/deploy-runtime-vps.sh`
- `scripts/verify-runtime-vps.sh`
- `scripts/rollback-runtime-vps.sh`
- `docker-compose.runtime.yml`

## Real VPS gate

A real VPS deployment can only be marked PASS after these commands run on the authorized VPS:

```bash
scripts/preflight-runtime-vps.sh
scripts/deploy-runtime-vps.sh
scripts/verify-runtime-vps.sh
```

Expected evidence:

```text
VPS_PREFLIGHT_PASS
RUNTIME_DEPLOY_PASS commit=<sha>
RUNTIME_VPS_VERIFY_PASS
```

## Security baseline

- Keep `.env.runtime` outside Git.
- MySQL must remain private.
- Runtime must remain localhost/WireGuard-only unless a separate TLS reverse proxy gate is approved.
- Do not expose `RUNTIME_API_TOKEN` or `OPENAI_API_KEY` in browser code.
- ChatGPT Library body remains authoritative and transient; it is not copied to Git or MySQL.

## Rollback

If deployment verification fails:

```bash
scripts/rollback-runtime-vps.sh
```

The script returns to the pre-deployment Git commit recorded in `.runtime-deploy/previous_ref`.
