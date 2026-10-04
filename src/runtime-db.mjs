import mysql from 'mysql2/promise';
import { randomUUID, createHash } from 'node:crypto';

let pool;

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

const runtimeDatabaseUrl = () => process.env.DATABASE_URL || process.env.MYSQL_URL || null;

export const runtimeDbConfigured = () =>
  Boolean(
    runtimeDatabaseUrl() ||
    (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER && process.env.DB_PASSWORD) ||
    (process.env.MYSQLHOST && process.env.MYSQLDATABASE && process.env.MYSQLUSER && process.env.MYSQLPASSWORD)
  );

export const checkRuntimeDbReady = async () => {
  if (!runtimeDbConfigured()) {
    return { ready: false, reason: 'RUNTIME_DB_NOT_CONFIGURED' };
  }
  try {
    const db = getRuntimePool();
    await db.query('SELECT 1');
    return { ready: true };
  } catch (error) {
    return {
      ready: false,
      reason: error.code || 'RUNTIME_DB_UNAVAILABLE',
    };
  }
};

export const getRuntimePool = () => {
  if (!runtimeDbConfigured()) {
    const error = new Error('Runtime database is not configured');
    error.code = 'RUNTIME_DB_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }
  if (!pool) {
    const databaseUrl = runtimeDatabaseUrl();
    const config = databaseUrl
      ? parseDatabaseUrl(databaseUrl)
      : process.env.DB_HOST
        ? {
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT || 3306),
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
          }
        : {
            host: process.env.MYSQLHOST,
            port: Number(process.env.MYSQLPORT || 3306),
            user: process.env.MYSQLUSER,
            password: process.env.MYSQLPASSWORD,
            database: process.env.MYSQLDATABASE,
          };
    pool = mysql.createPool({
      ...config,
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
      queueLimit: 0,
      timezone: 'Z',
      charset: 'utf8mb4',
    });
  }
  return pool;
};

const asJson = value => value == null ? null : JSON.stringify(value);

export const createProject = async input => {
  const db = getRuntimePool();
  const id = input.id || randomUUID();
  if (!input.projectKey || !input.name || !input.projectType) {
    const error = new Error('projectKey, name and projectType are required');
    error.code = 'INVALID_PROJECT';
    error.statusCode = 400;
    throw error;
  }
  await db.execute(
    `INSERT INTO projects (
      id, project_key, name, project_type, status,
      current_workflow_version, current_knowledge_commit_sha
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.projectKey,
      input.name,
      input.projectType,
      input.status || 'ACTIVE',
      input.currentWorkflowVersion || null,
      input.currentKnowledgeCommitSha || null,
    ]
  );
  return { id, projectKey: input.projectKey, name: input.name, projectType: input.projectType, status: input.status || 'ACTIVE' };
};

export const createRun = async input => {
  const db = getRuntimePool();
  if (!input.projectId) {
    const error = new Error('projectId is required');
    error.code = 'INVALID_RUN';
    error.statusCode = 400;
    throw error;
  }
  const id = input.id || randomUUID();
  const correlationId = input.correlationId || randomUUID();
  await db.execute(
    `INSERT INTO runs (
      id, correlation_id, project_id, parent_run_id, run_type, status, trigger_source,
      input_json, runtime_commit_sha, knowledge_commit_sha,
      workflow_version, router_version, rag_index_version, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [
      id,
      correlationId,
      input.projectId,
      input.parentRunId || null,
      input.runType || 'WORKFLOW',
      input.status || 'RUNNING',
      input.triggerSource || 'USER',
      asJson(input.input || null),
      input.runtimeCommitSha || null,
      input.knowledgeCommitSha || null,
      input.workflowVersion || null,
      input.routerVersion || null,
      input.ragIndexVersion || null,
    ]
  );
  return { id, projectId: input.projectId, correlationId, status: input.status || 'RUNNING' };
};

export const createTask = async input => {
  const db = getRuntimePool();
  if (!input.runId || !input.stageKey || !input.taskKey || !input.taskType || input.sequenceNo == null) {
    const error = new Error('runId, stageKey, taskKey, taskType and sequenceNo are required');
    error.code = 'INVALID_TASK';
    error.statusCode = 400;
    throw error;
  }
  const id = input.id || randomUUID();
  let correlationId = input.correlationId || null;
  if (!correlationId) {
    const [runRows] = await db.execute('SELECT correlation_id FROM runs WHERE id = ?', [input.runId]);
    correlationId = runRows[0]?.correlation_id || null;
  }
  await db.execute(
    `INSERT INTO tasks (
      id, run_id, correlation_id, parent_task_id, stage_key, task_key, task_type,
      status, sequence_no, input_json, dependency_json, max_retries, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
    [
      id,
      input.runId,
      correlationId,
      input.parentTaskId || null,
      input.stageKey,
      input.taskKey,
      input.taskType,
      input.status || 'RUNNING',
      Number(input.sequenceNo),
      asJson(input.input || null),
      asJson(input.dependencies || null),
      Number(input.maxRetries || 0),
    ]
  );
  return {
    id,
    runId: input.runId,
    correlationId,
    taskKey: input.taskKey,
    status: input.status || 'RUNNING'
  };
};

export const updateTask = async (taskId, input) => {
  const db = getRuntimePool();
  const fields = [];
  const values = [];

  if (input.status !== undefined) { fields.push('status = ?'); values.push(input.status); }
  if (input.output !== undefined) { fields.push('output_json = ?'); values.push(asJson(input.output)); }
  if (input.retryCount !== undefined) { fields.push('retry_count = ?'); values.push(Number(input.retryCount)); }
  if (input.errorCode !== undefined) { fields.push('error_code = ?'); values.push(input.errorCode); }
  if (input.errorCategory !== undefined) { fields.push('error_category = ?'); values.push(input.errorCategory); }
  if (input.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(input.errorMessage); }
  if (input.finished === true) { fields.push('finished_at = CURRENT_TIMESTAMP(6)'); }

  if (!fields.length) {
    const error = new Error('No supported task fields supplied');
    error.code = 'EMPTY_TASK_UPDATE';
    error.statusCode = 400;
    throw error;
  }

  values.push(taskId);
  const [result] = await db.execute(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
  if (!result.affectedRows) {
    const error = new Error('Task not found');
    error.code = 'TASK_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return { id: taskId, updated: true };
};

export const saveCheckpoint = async (runId, input) => {
  const db = getRuntimePool();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [runRows] = await connection.execute('SELECT id, correlation_id FROM runs WHERE id = ? FOR UPDATE', [runId]);
    if (!runRows.length) {
      const error = new Error('Run not found');
      error.code = 'RUN_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    const [sequenceRows] = await connection.execute(
      'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence FROM checkpoints WHERE run_id = ?',
      [runId]
    );
    const sequenceNo = Number(sequenceRows[0].next_sequence);
    const id = input.id || randomUUID();
    const correlationId = input.correlationId || runRows[0].correlation_id || null;

    await connection.execute(
      `INSERT INTO checkpoints (
        id, run_id, task_id, correlation_id, sequence_no, checkpoint_type, status,
        stage_key, step_key, state_json,
        completed_task_keys_json, pending_task_keys_json, blocked_task_keys_json,
        dependency_fingerprint, runtime_commit_sha, knowledge_commit_sha,
        workflow_version, router_version, resume_from_task_key, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        runId,
        input.taskId || null,
        correlationId,
        sequenceNo,
        input.checkpointType || 'AUTO',
        input.status || 'VALID',
        input.stageKey || null,
        input.stepKey || null,
        asJson(input.state || {}),
        asJson(input.completedTaskKeys || []),
        asJson(input.pendingTaskKeys || []),
        asJson(input.blockedTaskKeys || []),
        input.dependencyFingerprint || null,
        input.runtimeCommitSha || null,
        input.knowledgeCommitSha || null,
        input.workflowVersion || null,
        input.routerVersion || null,
        input.resumeFromTaskKey || null,
        input.createdBy || 'SYSTEM',
      ]
    );
    await connection.execute(
      'UPDATE runs SET last_checkpoint_at = CURRENT_TIMESTAMP(6) WHERE id = ?',
      [runId]
    );
    await connection.commit();
    return {
      id,
      runId,
      correlationId,
      sequenceNo,
      status: input.status || 'VALID',
      resumeFromTaskKey: input.resumeFromTaskKey || null
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const normalizeCheckpoint = row => row ? ({
  id: row.id,
  runId: row.run_id,
  taskId: row.task_id,
  correlationId: row.correlation_id || null,
  sequenceNo: Number(row.sequence_no),
  checkpointType: row.checkpoint_type,
  status: row.status,
  stageKey: row.stage_key,
  stepKey: row.step_key,
  state: row.state_json,
  completedTaskKeys: row.completed_task_keys_json,
  pendingTaskKeys: row.pending_task_keys_json,
  blockedTaskKeys: row.blocked_task_keys_json,
  dependencyFingerprint: row.dependency_fingerprint,
  runtimeCommitSha: row.runtime_commit_sha,
  knowledgeCommitSha: row.knowledge_commit_sha,
  workflowVersion: row.workflow_version,
  routerVersion: row.router_version,
  resumeFromTaskKey: row.resume_from_task_key,
  createdAt: row.created_at,
}) : null;

export const getLatestCheckpoint = async runId => {
  const db = getRuntimePool();
  const [rows] = await db.execute(
    `SELECT *
     FROM checkpoints
     WHERE run_id = ? AND status = 'VALID'
     ORDER BY sequence_no DESC
     LIMIT 1`,
    [runId]
  );
  if (!rows.length) {
    const error = new Error('No valid checkpoint found');
    error.code = 'CHECKPOINT_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return normalizeCheckpoint(rows[0]);
};

export const resumeRun = async (runId, expected = {}) => {
  const checkpoint = await getLatestCheckpoint(runId);
  const comparisons = {
    runtimeCommitSha: checkpoint.runtimeCommitSha,
    workflowVersion: checkpoint.workflowVersion,
    routerVersion: checkpoint.routerVersion,
    knowledgeCommitSha: checkpoint.knowledgeCommitSha,
    dependencyFingerprint: checkpoint.dependencyFingerprint,
  };

  const changedFields = Object.entries(expected)
    .filter(([key, value]) => value != null && comparisons[key] !== value)
    .map(([key]) => key);

  if (changedFields.length) {
    const error = new Error('Checkpoint dependencies changed; explicit invalidation is required');
    error.code = 'RESUME_INVALIDATED';
    error.statusCode = 409;
    error.details = { changedFields, checkpoint };
    throw error;
  }

  const db = getRuntimePool();
  await db.execute(
    `UPDATE runs
     SET status = 'RUNNING', error_code = NULL, error_message = NULL
     WHERE id = ?`,
    [runId]
  );
  return {
    runId,
    checkpointId: checkpoint.id,
    checkpointSequenceNo: checkpoint.sequenceNo,
    resumeFromTaskKey: checkpoint.resumeFromTaskKey,
    checkpoint,
  };
};


const normalizeKnowledgeRow = row => ({
  id: row.id,
  runId: row.run_id,
  taskId: row.task_id,
  sourceProvider: row.source_provider,
  sourceFileId: row.source_file_id,
  sourceLibraryFileId: row.source_library_file_id,
  sourceVersion: row.source_version,
  sourcePath: row.source_path,
  sourceName: row.source_name,
  sourceModifiedAt: row.source_modified_at,
  sourceStatus: row.source_status,
  precedenceRank: row.precedence_rank == null ? null : Number(row.precedence_rank),
  retrievalQuery: row.retrieval_query,
  retrievalMode: row.retrieval_mode,
  contextRole: row.context_role,
  sourceLineStart: row.source_line_start == null ? null : Number(row.source_line_start),
  sourceLineEnd: row.source_line_end == null ? null : Number(row.source_line_end),
  contentSha256: row.content_sha256,
  retrievedAt: row.retrieved_at,
});

const rejectKnowledgeBody = item => {
  const forbidden = ['content', 'body', 'text', 'snippet', 'sourceText', 'source_text'];
  const found = forbidden.find(key => item?.[key] !== undefined);
  if (found) {
    const error = new Error(`Knowledge context must not persist source body field: ${found}`);
    error.code = 'SOURCE_BODY_NOT_ALLOWED';
    error.statusCode = 400;
    throw error;
  }
};

export const addKnowledgeContexts = async (runId, input) => {
  const db = getRuntimePool();
  const items = Array.isArray(input?.items) ? input.items : [];
  if (!items.length) {
    const error = new Error('items must contain at least one knowledge context');
    error.code = 'INVALID_KNOWLEDGE_CONTEXT';
    error.statusCode = 400;
    throw error;
  }

  const [runRows] = await db.execute('SELECT id FROM runs WHERE id = ?', [runId]);
  if (!runRows.length) {
    const error = new Error('Run not found');
    error.code = 'RUN_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const stored = [];
  for (const item of items) {
    rejectKnowledgeBody(item);
    if (!item.sourceFileId || !item.contextRole || !/^[a-f0-9]{64}$/i.test(item.contentSha256 || '')) {
      const error = new Error('sourceFileId, contextRole and a SHA-256 contentSha256 are required');
      error.code = 'INVALID_KNOWLEDGE_CONTEXT_ITEM';
      error.statusCode = 400;
      throw error;
    }
    const sourceProvider = item.sourceProvider || 'CHATGPT_LIBRARY';
    if (sourceProvider !== 'CHATGPT_LIBRARY') {
      const error = new Error('Only CHATGPT_LIBRARY is allowed in the current knowledge flow');
      error.code = 'UNSUPPORTED_KNOWLEDGE_PROVIDER';
      error.statusCode = 400;
      throw error;
    }

    const id = item.id || randomUUID();
    await db.execute(
      `INSERT INTO knowledge_contexts (
        id, run_id, task_id, source_provider, source_file_id,
        source_library_file_id, source_version, source_path, source_name,
        source_modified_at, source_status, precedence_rank,
        retrieval_query, retrieval_mode, context_role,
        source_line_start, source_line_end, content_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        runId,
        item.taskId || null,
        sourceProvider,
        item.sourceFileId,
        item.sourceLibraryFileId || null,
        item.sourceVersion || null,
        item.sourcePath || null,
        item.sourceName || null,
        item.sourceModifiedAt ? new Date(item.sourceModifiedAt) : null,
        item.sourceStatus || null,
        item.precedenceRank == null ? null : Number(item.precedenceRank),
        item.retrievalQuery || null,
        item.retrievalMode || null,
        item.contextRole,
        item.sourceLineStart == null ? null : Number(item.sourceLineStart),
        item.sourceLineEnd == null ? null : Number(item.sourceLineEnd),
        item.contentSha256.toLowerCase(),
      ]
    );

    stored.push({
      id,
      sourceProvider,
      sourceFileId: item.sourceFileId,
      sourceVersion: item.sourceVersion || null,
      contextRole: item.contextRole,
      sourceLineStart: item.sourceLineStart == null ? null : Number(item.sourceLineStart),
      sourceLineEnd: item.sourceLineEnd == null ? null : Number(item.sourceLineEnd),
      contentSha256: item.contentSha256.toLowerCase(),
    });
  }

  return { runId, count: stored.length, items: stored };
};

export const listKnowledgeContexts = async runId => {
  const db = getRuntimePool();
  const [rows] = await db.execute(
    `SELECT *
     FROM knowledge_contexts
     WHERE run_id = ?
     ORDER BY precedence_rank ASC, retrieved_at ASC, id ASC`,
    [runId]
  );
  return rows.map(normalizeKnowledgeRow);
};

export const getKnowledgeContextFingerprint = async runId => {
  const contexts = await listKnowledgeContexts(runId);
  const material = contexts
    .map(item => [
      item.sourceProvider,
      item.sourceFileId,
      item.sourceVersion || '',
      item.sourceLineStart ?? '',
      item.sourceLineEnd ?? '',
      item.contentSha256,
      item.contextRole,
      item.precedenceRank ?? '',
    ].join(':'))
    .join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex');
};
