import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const HEALTH = new Set(['HEALTHY','DEGRADED','DOWN','UNKNOWN']);
const QUALITY = new Set(['BASIC','STANDARD','HIGH','PREMIUM']);
const LATENCY = new Set(['FAST','BALANCED','SLOW']);
const COST = new Set(['LOW','MEDIUM','HIGH']);

const asJson = value => value == null ? null : JSON.stringify(value);
const secretPattern = /(api[_-]?key|secret|token|password|credential|authorization)/i;

const errorOf = (message, code, statusCode = 400, details) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (details) error.details = details;
  return error;
};

const rejectSecrets = value => {
  const visit = (node, path = '') => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (secretPattern.test(key)) {
        throw errorOf(
          'Provider registry must not persist credentials or secrets',
          'PROVIDER_REGISTRY_SECRET_NOT_ALLOWED',
          400,
          { field: next }
        );
      }
      visit(child, next);
    }
  };
  visit(value);
};

const normalizeProvider = row => ({
  providerKey: row.provider_key,
  providerType: row.provider_type,
  displayName: row.display_name,
  adapterKey: row.adapter_key,
  enabled: Boolean(row.enabled),
  healthStatus: row.health_status,
  priority: Number(row.priority),
  supportsStructuredOutput: Boolean(row.supports_structured_output),
  metadata: row.metadata_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeModel = row => ({
  providerKey: row.provider_key,
  modelKey: row.model_key,
  displayName: row.display_name,
  enabled: Boolean(row.enabled),
  qualityTier: row.quality_tier,
  latencyTier: row.latency_tier,
  costTier: row.cost_tier,
  priority: Number(row.priority),
  capabilities: row.capabilities_json,
  metadata: row.metadata_json,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const upsertProvider = async input => {
  if (!input?.providerKey || !input?.providerType || !input?.displayName || !input?.adapterKey) {
    throw errorOf(
      'providerKey, providerType, displayName and adapterKey are required',
      'INVALID_PROVIDER_REGISTRY_ENTRY'
    );
  }
  rejectSecrets(input);
  const healthStatus = String(input.healthStatus || 'HEALTHY').toUpperCase();
  if (!HEALTH.has(healthStatus)) {
    throw errorOf('Unsupported provider healthStatus', 'INVALID_PROVIDER_HEALTH_STATUS');
  }

  const db = getRuntimePool();
  await db.execute(
    `INSERT INTO provider_registry (
      provider_key, provider_type, display_name, adapter_key, enabled,
      health_status, priority, supports_structured_output, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      provider_type = VALUES(provider_type),
      display_name = VALUES(display_name),
      adapter_key = VALUES(adapter_key),
      enabled = VALUES(enabled),
      health_status = VALUES(health_status),
      priority = VALUES(priority),
      supports_structured_output = VALUES(supports_structured_output),
      metadata_json = VALUES(metadata_json)`,
    [
      input.providerKey,
      String(input.providerType).toUpperCase(),
      input.displayName,
      input.adapterKey,
      input.enabled === false ? 0 : 1,
      healthStatus,
      Number(input.priority ?? 100),
      input.supportsStructuredOutput === true ? 1 : 0,
      asJson(input.metadata || null),
    ]
  );

  const [rows] = await db.execute(
    'SELECT * FROM provider_registry WHERE provider_key = ?',
    [input.providerKey]
  );
  return normalizeProvider(rows[0]);
};

export const upsertModel = async input => {
  if (!input?.providerKey || !input?.modelKey || !input?.displayName) {
    throw errorOf(
      'providerKey, modelKey and displayName are required',
      'INVALID_MODEL_REGISTRY_ENTRY'
    );
  }
  rejectSecrets(input);

  const qualityTier = String(input.qualityTier || 'STANDARD').toUpperCase();
  const latencyTier = String(input.latencyTier || 'BALANCED').toUpperCase();
  const costTier = String(input.costTier || 'MEDIUM').toUpperCase();
  if (!QUALITY.has(qualityTier) || !LATENCY.has(latencyTier) || !COST.has(costTier)) {
    throw errorOf('Unsupported quality/latency/cost tier', 'INVALID_MODEL_TIER');
  }

  const db = getRuntimePool();
  const [providers] = await db.execute(
    'SELECT provider_key FROM provider_registry WHERE provider_key = ?',
    [input.providerKey]
  );
  if (!providers.length) {
    throw errorOf('Provider not found', 'PROVIDER_NOT_FOUND', 404);
  }

  await db.execute(
    `INSERT INTO model_registry (
      provider_key, model_key, display_name, enabled,
      quality_tier, latency_tier, cost_tier, priority,
      capabilities_json, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      display_name = VALUES(display_name),
      enabled = VALUES(enabled),
      quality_tier = VALUES(quality_tier),
      latency_tier = VALUES(latency_tier),
      cost_tier = VALUES(cost_tier),
      priority = VALUES(priority),
      capabilities_json = VALUES(capabilities_json),
      metadata_json = VALUES(metadata_json)`,
    [
      input.providerKey,
      input.modelKey,
      input.displayName,
      input.enabled === false ? 0 : 1,
      qualityTier,
      latencyTier,
      costTier,
      Number(input.priority ?? 100),
      asJson(input.capabilities || null),
      asJson(input.metadata || null),
    ]
  );

  const [rows] = await db.execute(
    'SELECT * FROM model_registry WHERE provider_key = ? AND model_key = ?',
    [input.providerKey, input.modelKey]
  );
  return normalizeModel(rows[0]);
};

export const setProviderHealth = async (providerKey, input = {}) => {
  const healthStatus = String(input.healthStatus || '').toUpperCase();
  if (!providerKey || !HEALTH.has(healthStatus)) {
    throw errorOf('providerKey and valid healthStatus are required', 'INVALID_PROVIDER_HEALTH_UPDATE');
  }
  rejectSecrets(input);

  const db = getRuntimePool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT health_status FROM provider_registry WHERE provider_key = ? FOR UPDATE',
      [providerKey]
    );
    if (!rows.length) throw errorOf('Provider not found', 'PROVIDER_NOT_FOUND', 404);

    const previousStatus = rows[0].health_status;
    await connection.execute(
      'UPDATE provider_registry SET health_status = ? WHERE provider_key = ?',
      [healthStatus, providerKey]
    );
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO provider_health_events (
        id, provider_key, previous_status, health_status,
        reason_code, evidence_json, recorded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        providerKey,
        previousStatus,
        healthStatus,
        input.reasonCode || null,
        asJson(input.evidence || null),
        input.recordedBy || 'RUNTIME',
      ]
    );
    await connection.commit();
    return { id, providerKey, previousStatus, healthStatus };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const listProviderRegistry = async () => {
  const db = getRuntimePool();
  const [providerRows] = await db.execute(
    'SELECT * FROM provider_registry ORDER BY priority, provider_key'
  );
  const [modelRows] = await db.execute(
    'SELECT * FROM model_registry ORDER BY provider_key, priority, model_key'
  );
  return {
    providers: providerRows.map(normalizeProvider),
    models: modelRows.map(normalizeModel),
  };
};

export const listRoutingCandidates = async () => {
  const db = getRuntimePool();
  const [rows] = await db.execute(
    `SELECT
       p.provider_key, p.provider_type, p.display_name AS provider_display_name,
       p.adapter_key, p.enabled AS provider_enabled, p.health_status,
       p.priority AS provider_priority, p.supports_structured_output,
       p.metadata_json AS provider_metadata,
       m.model_key, m.display_name AS model_display_name,
       m.enabled AS model_enabled, m.quality_tier, m.latency_tier,
       m.cost_tier, m.priority AS model_priority,
       m.capabilities_json, m.metadata_json AS model_metadata
     FROM provider_registry p
     JOIN model_registry m ON m.provider_key = p.provider_key
     ORDER BY p.priority, p.provider_key, m.priority, m.model_key`
  );
  return rows.map(row => ({
    providerKey: row.provider_key,
    providerType: row.provider_type,
    providerDisplayName: row.provider_display_name,
    adapterKey: row.adapter_key,
    providerEnabled: Boolean(row.provider_enabled),
    healthStatus: row.health_status,
    providerPriority: Number(row.provider_priority),
    supportsStructuredOutput: Boolean(row.supports_structured_output),
    providerMetadata: row.provider_metadata,
    modelKey: row.model_key,
    modelDisplayName: row.model_display_name,
    modelEnabled: Boolean(row.model_enabled),
    qualityTier: row.quality_tier,
    latencyTier: row.latency_tier,
    costTier: row.cost_tier,
    modelPriority: Number(row.model_priority),
    capabilities: row.capabilities_json,
    modelMetadata: row.model_metadata,
  }));
};
