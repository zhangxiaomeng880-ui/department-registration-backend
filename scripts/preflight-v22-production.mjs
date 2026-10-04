import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

const parseDatabaseUrl = value => {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
  };
};

const resolveDbConfig = () => {
  const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || null;
  if (databaseUrl) return parseDatabaseUrl(databaseUrl);
  if (process.env.DB_HOST) {
    return {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };
  }
  return {
    host: process.env.MYSQLHOST,
    port: Number(process.env.MYSQLPORT || 3306),
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
  };
};

const BASE_MIGRATIONS = [
  '001_runtime_persistence.sql',
  '002_knowledge_contexts.sql',
  '002_knowledge_source_adapter.sql',
  '003_knowledge_retrieval_provenance.sql',
  '004_runtime_observability.sql',
  '005_policy_router_v2.sql',
  '006_cost_ledger.sql',
];

const V22_MIGRATIONS = [
  '007_commercial_pricing_catalog.sql',
  '008_tenant_workspace_quota_meter.sql',
  '009_commercial_control.sql',
  '010_tenant_identity_rbac.sql',
  '011_subscription_billing_ledger.sql',
  '012_v21_rollback_compatibility.sql',
];

const TARGET_TABLES = {
  '008_tenant_workspace_quota_meter.sql': [
    'tenants','workspaces','quota_policies','quota_evaluations',
  ],
  '009_commercial_control.sql': [
    'plans','plan_entitlements','entitlement_evaluations',
    'rate_limit_policies','rate_limit_buckets','rate_limit_decisions','usage_reservations',
  ],
  '010_tenant_identity_rbac.sql': [
    'identities','rbac_roles','rbac_role_permissions','tenant_memberships',
    'workspace_memberships','api_credentials','authorization_decisions',
  ],
  '011_subscription_billing_ledger.sql': [
    'plan_billing_terms','subscriptions','billing_cycles','invoices',
    'invoice_items','billing_usage_settlements','credit_ledger',
  ],
};

const TARGET_COLUMNS = {
  '007_commercial_pricing_catalog.sql': [
    ['pricing_versions','service_tier'],
    ['tool_executions','service_tier'],
    ['usage_ledger','service_tier'],
  ],
  '008_tenant_workspace_quota_meter.sql': [
    ['projects','tenant_id'],['projects','workspace_id'],
    ['runs','tenant_id'],['runs','workspace_id'],
    ['usage_ledger','tenant_id'],['usage_ledger','workspace_id'],
  ],
};

const TARGET_CONSTRAINTS = {
  '008_tenant_workspace_quota_meter.sql': [
    'fk_workspace_tenant','fk_project_tenant','fk_project_workspace',
    'fk_run_tenant','fk_run_workspace','fk_usage_tenant','fk_usage_workspace',
    'fk_quota_policy_tenant','fk_quota_eval_tenant','fk_quota_eval_workspace',
    'fk_quota_eval_run','fk_quota_eval_policy',
  ],
  '009_commercial_control.sql': [
    'fk_tenant_plan','fk_entitlement_plan','fk_ent_eval_tenant','fk_ent_eval_workspace',
    'fk_ent_eval_run','fk_ent_eval_plan','fk_rate_plan','fk_rate_tenant',
    'fk_rate_workspace','fk_rate_bucket_policy','fk_rate_decision_tenant',
    'fk_rate_decision_workspace','fk_rate_decision_run','fk_rate_decision_policy',
    'fk_reservation_tenant','fk_reservation_workspace','fk_reservation_project',
    'fk_reservation_run','fk_reservation_plan','fk_reservation_tool',
  ],
  '010_tenant_identity_rbac.sql': [
    'fk_m224_role_permission_role','fk_m224_tenant_membership_tenant',
    'fk_m224_tenant_membership_identity','fk_m224_tenant_membership_role',
    'fk_m224_workspace_membership_workspace','fk_m224_workspace_membership_identity',
    'fk_m224_workspace_membership_role','fk_m224_credential_identity',
    'fk_m224_credential_tenant','fk_m224_credential_workspace',
    'fk_m224_authz_credential','fk_m224_authz_identity','fk_m224_authz_tenant',
    'fk_m224_authz_workspace',
  ],
  '011_subscription_billing_ledger.sql': [
    'fk_m225_billing_term_plan','fk_m225_subscription_tenant','fk_m225_subscription_plan',
    'fk_m225_subscription_term','fk_m225_cycle_subscription','fk_m225_cycle_tenant',
    'fk_m225_cycle_plan','fk_m225_cycle_term','fk_m225_invoice_tenant',
    'fk_m225_invoice_subscription','fk_m225_invoice_cycle','fk_m225_invoice_item_invoice',
    'fk_m225_settlement_usage','fk_m225_settlement_tenant','fk_m225_settlement_cycle',
    'fk_m225_settlement_invoice','fk_m225_credit_tenant','fk_m225_credit_subscription',
    'fk_m225_credit_cycle','fk_m225_credit_invoice',
  ],
};

const assert = (condition, code, message, details={}) => {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    throw error;
  }
};

const queryScalar = async (db, sql, params=[]) => {
  const [rows] = await db.execute(sql, params);
  const first = rows[0] || {};
  return Number(Object.values(first)[0] || 0);
};

const tableExists = async (db, _schema, table) => {
  try {
    await db.query(`SELECT 1 FROM \`${table}\` LIMIT 0`);
    return true;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return false;
    throw error;
  }
};

const columnExists = async (db, _schema, table, column) => {
  try {
    const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
    return rows.some(row => row.Field === column);
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return false;
    throw error;
  }
};

const indexExists = async (db, _schema, table, index) => {
  const [rows] = await db.query(`SHOW INDEX FROM \`${table}\``);
  return rows.some(row => row.Key_name === index);
};

const summarizeRows = async db => {
  const tables = ['projects','runs','usage_ledger','pricing_versions'];
  const counts = {};
  for (const table of tables) {
    counts[table] = await queryScalar(db, `SELECT COUNT(*) AS c FROM \`${table}\``);
  }
  return counts;
};

export async function runV22ProductionPreflight({ config = resolveDbConfig() } = {}) {
  assert(config.host && config.user && config.password && config.database,
    'PREFLIGHT_DB_CONFIG_INCOMPLETE',
    'Database configuration is incomplete');

  const db = await mysql.createConnection({
    ...config,
    multipleStatements: false,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  });

  const summary = {
    status: 'PASS',
    database: config.database,
    baseMigrationsRequired: BASE_MIGRATIONS.length,
    v22MigrationsTotal: V22_MIGRATIONS.length,
    appliedV22Migrations: [],
    pendingV22Migrations: [],
    rowCounts: {},
    checks: {},
  };

  try {
    let migrationRows;
    try {
      [migrationRows] = await db.query(
        'SELECT file_name FROM schema_migrations ORDER BY file_name'
      );
    } catch (error) {
      if (error.code === 'ER_NO_SUCH_TABLE') {
        const missing = new Error('schema_migrations table is missing');
        missing.code = 'PREFLIGHT_SCHEMA_MIGRATIONS_MISSING';
        throw missing;
      }
      throw error;
    }
    const applied = new Set(migrationRows.map(x => x.file_name));

    const missingBase = BASE_MIGRATIONS.filter(x => !applied.has(x));
    assert(missingBase.length === 0,
      'PREFLIGHT_BASELINE_INCOMPLETE',
      'V2.1 production baseline migrations are incomplete',
      { missingBase });

    summary.appliedV22Migrations = V22_MIGRATIONS.filter(x => applied.has(x));
    summary.pendingV22Migrations = V22_MIGRATIONS.filter(x => !applied.has(x));

    const prefixLength = summary.appliedV22Migrations.length;
    const expectedPrefix = V22_MIGRATIONS.slice(0, prefixLength);
    assert(
      expectedPrefix.every((x, i) => summary.appliedV22Migrations[i] === x),
      'PREFLIGHT_V22_MIGRATION_GAP',
      'V2.2 migrations are not a contiguous applied prefix',
      { appliedV22Migrations: summary.appliedV22Migrations }
    );

    summary.rowCounts = await summarizeRows(db);

    if (!applied.has('007_commercial_pricing_catalog.sql')) {
      assert(await indexExists(db, config.database, 'pricing_versions', 'uq_price_effective'),
        'PREFLIGHT_M007_OLD_INDEX_MISSING',
        'Expected V2.1 pricing index uq_price_effective is missing');

      assert(!(await indexExists(db, config.database, 'pricing_versions', 'uq_price_effective_tier')),
        'PREFLIGHT_M007_PARTIAL_INDEX',
        'M22.1 replacement pricing index exists without migration record');

      for (const [table, column] of TARGET_COLUMNS['007_commercial_pricing_catalog.sql']) {
        assert(!(await columnExists(db, config.database, table, column)),
          'PREFLIGHT_M007_PARTIAL_COLUMN',
          `M22.1 column already exists without migration record: ${table}.${column}`);
      }

      const duplicatePriceKeys = await queryScalar(db, `
        SELECT COUNT(*) AS c FROM (
          SELECT provider_key, model_key, effective_from
          FROM pricing_versions
          GROUP BY provider_key, model_key, effective_from
          HAVING COUNT(*) > 1
        ) d
      `);
      assert(duplicatePriceKeys === 0,
        'PREFLIGHT_M007_PRICING_DUPLICATES',
        'Existing pricing rows would conflict with M22.1 unique pricing key',
        { duplicatePriceKeys });
      summary.checks.m007PricingShape = 'PASS';
    }

    if (!applied.has('008_tenant_workspace_quota_meter.sql')) {
      for (const table of TARGET_TABLES['008_tenant_workspace_quota_meter.sql']) {
        assert(!(await tableExists(db, config.database, table)),
          'PREFLIGHT_M008_PARTIAL_TABLE',
          `M22.2 table already exists without migration record: ${table}`);
      }
      for (const [table, column] of TARGET_COLUMNS['008_tenant_workspace_quota_meter.sql']) {
        assert(!(await columnExists(db, config.database, table, column)),
          'PREFLIGHT_M008_PARTIAL_COLUMN',
          `M22.2 column already exists without migration record: ${table}.${column}`);
      }

      const runOrphans = await queryScalar(db, `
        SELECT COUNT(*) AS c
        FROM runs r
        LEFT JOIN projects p ON p.id=r.project_id
        WHERE r.project_id IS NULL OR p.id IS NULL
      `);
      const usageOrphans = await queryScalar(db, `
        SELECT COUNT(*) AS c
        FROM usage_ledger u
        LEFT JOIN projects p ON p.id=u.project_id
        WHERE u.project_id IS NULL OR p.id IS NULL
      `);
      assert(runOrphans === 0,
        'PREFLIGHT_M008_RUN_ORPHANS',
        'Runs contain project references that cannot be tenant/workspace backfilled',
        { runOrphans });
      assert(usageOrphans === 0,
        'PREFLIGHT_M008_USAGE_ORPHANS',
        'Usage ledger contains project references that cannot be tenant/workspace backfilled',
        { usageOrphans });
      summary.checks.m008BackfillIntegrity = 'PASS';
    }

    for (const migration of ['009_commercial_control.sql','010_tenant_identity_rbac.sql','011_subscription_billing_ledger.sql']) {
      if (applied.has(migration)) continue;
      for (const table of TARGET_TABLES[migration]) {
        assert(!(await tableExists(db, config.database, table)),
          'PREFLIGHT_PARTIAL_V22_TABLE',
          `V2.2 table already exists without migration record: ${table}`,
          { migration, table });
      }
    }

    if (summary.pendingV22Migrations.length) {
      const pendingConstraints = summary.pendingV22Migrations
        .flatMap(migration => TARGET_CONSTRAINTS[migration] || []);
      if (pendingConstraints.length) {
        const placeholders = pendingConstraints.map(() => '?').join(',');
        const [constraintRows] = await db.execute(`
          SELECT constraint_name, table_name
          FROM information_schema.referential_constraints
          WHERE constraint_schema=? AND constraint_name IN (${placeholders})
        `, [config.database, ...pendingConstraints]);

        assert(constraintRows.length === 0,
          'PREFLIGHT_FK_NAME_COLLISION',
          'One or more pending V2.2 foreign-key names already exist in the schema',
          { collisions: constraintRows });
      }
      summary.checks.foreignKeyNamesAvailable = 'PASS';
    }

    summary.checks.baseMigrationBaseline = 'PASS';
    summary.checks.partialSchemaDetection = 'PASS';
    summary.checks.historicalDataBackfill = 'PASS';

    console.log('V22_PRODUCTION_PREFLIGHT_PASS ' + JSON.stringify(summary));
    return summary;
  } catch (error) {
    const failure = {
      status: 'FAIL',
      code: error.code || 'PREFLIGHT_ERROR',
      message: error.message,
      details: error.details || {},
      appliedV22Migrations: summary.appliedV22Migrations,
      pendingV22Migrations: summary.pendingV22Migrations,
      rowCounts: summary.rowCounts,
    };
    console.error('V22_PRODUCTION_PREFLIGHT_FAIL ' + JSON.stringify(failure));
    throw Object.assign(error, { preflight: failure });
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runV22ProductionPreflight().catch(() => {
    process.exitCode = 1;
  });
}
