import { createHash, randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
const jsonValue = value => value == null ? null : JSON.stringify(value);

const assertNoSourceBody = item => {
  const forbidden = ['content', 'body', 'text', 'snippet', 'sourceText', 'source_text'];
  const found = forbidden.find(key => item?.[key] != null);
  if (found) {
    const error = new Error(`Retrieval provenance must not persist source body field: ${found}`);
    error.code = 'SOURCE_BODY_NOT_ALLOWED';
    error.statusCode = 400;
    throw error;
  }
};

export const recordKnowledgeRetrieval = async input => {
  if (!input?.sourceKey || !input?.query || !Array.isArray(input.items)) {
    const error = new Error('sourceKey, query and items[] are required');
    error.code = 'INVALID_KNOWLEDGE_RETRIEVAL';
    error.statusCode = 400;
    throw error;
  }

  input.items.forEach(assertNoSourceBody);

  const db = getRuntimePool();
  const connection = await db.getConnection();
  const retrievalId = input.id || randomUUID();

  try {
    await connection.beginTransaction();

    const [sourceRows] = await connection.execute(
      'SELECT id FROM knowledge_sources WHERE source_key = ? AND status = \'ACTIVE\' LIMIT 1',
      [input.sourceKey]
    );
    if (!sourceRows.length) {
      const error = new Error('Knowledge source not found or inactive');
      error.code = 'KNOWLEDGE_SOURCE_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    const sourceId = sourceRows[0].id;
    const selectedCount = input.items.filter(item => item.selected !== false).length;

    await connection.execute(
      `INSERT INTO knowledge_retrievals (
        id, run_id, task_id, source_id, query_text, query_hash,
        retrieval_mode, status, candidate_count, selected_count,
        context_hash, policy_json, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))`,
      [
        retrievalId,
        input.runId || null,
        input.taskId || null,
        sourceId,
        input.query,
        sha256(input.query),
        input.retrievalMode || 'LIBRARY_SEARCH_READ',
        input.status || 'PASS',
        input.items.length,
        selectedCount,
        input.contextHash || null,
        jsonValue(input.policy || null),
      ]
    );

    let rank = 0;
    for (const item of input.items) {
      rank += 1;
      if (!item.externalFileId && !item.libraryFileId) {
        const error = new Error('Each retrieval item requires externalFileId or libraryFileId');
        error.code = 'INVALID_RETRIEVAL_ITEM';
        error.statusCode = 400;
        throw error;
      }

      const externalFileId = item.externalFileId || item.libraryFileId;
      const [documentRows] = await connection.execute(
        `SELECT d.id
         FROM knowledge_documents d
         WHERE d.source_id = ?
           AND (d.external_file_id = ? OR d.library_file_id = ?)
         LIMIT 1`,
        [sourceId, externalFileId, item.libraryFileId || externalFileId]
      );

      await connection.execute(
        `INSERT INTO knowledge_retrieval_items (
          id, retrieval_id, document_id, external_file_id, library_file_id,
          version_id, source_path, rank_no, relevance_score, selected,
          line_start, line_end, content_hash, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id || randomUUID(),
          retrievalId,
          documentRows[0]?.id || null,
          externalFileId,
          item.libraryFileId || null,
          item.versionId == null ? null : String(item.versionId),
          item.sourcePath || null,
          Number(item.rankNo || rank),
          item.relevanceScore == null ? null : Number(item.relevanceScore),
          item.selected !== false,
          item.lineStart == null ? null : Number(item.lineStart),
          item.lineEnd == null ? null : Number(item.lineEnd),
          item.contentHash || null,
          jsonValue(item.metadata || null),
        ]
      );
    }

    await connection.commit();
    return {
      id: retrievalId,
      sourceKey: input.sourceKey,
      queryHash: sha256(input.query),
      candidateCount: input.items.length,
      selectedCount,
      contextHash: input.contextHash || null,
      status: input.status || 'PASS',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const getKnowledgeRetrieval = async retrievalId => {
  const db = getRuntimePool();
  const [retrievalRows] = await db.execute(
    `SELECT r.id, r.run_id, r.task_id, s.source_key, r.query_text,
            r.query_hash, r.retrieval_mode, r.status, r.candidate_count,
            r.selected_count, r.context_hash, r.policy_json,
            r.started_at, r.finished_at
     FROM knowledge_retrievals r
     JOIN knowledge_sources s ON s.id = r.source_id
     WHERE r.id = ?
     LIMIT 1`,
    [retrievalId]
  );
  if (!retrievalRows.length) {
    const error = new Error('Knowledge retrieval not found');
    error.code = 'KNOWLEDGE_RETRIEVAL_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }

  const [itemRows] = await db.execute(
    `SELECT external_file_id, library_file_id, version_id, source_path,
            rank_no, relevance_score, selected, line_start, line_end,
            content_hash, metadata_json
     FROM knowledge_retrieval_items
     WHERE retrieval_id = ?
     ORDER BY rank_no`,
    [retrievalId]
  );

  const row = retrievalRows[0];
  return {
    id: row.id,
    runId: row.run_id,
    taskId: row.task_id,
    sourceKey: row.source_key,
    query: row.query_text,
    queryHash: row.query_hash,
    retrievalMode: row.retrieval_mode,
    status: row.status,
    candidateCount: Number(row.candidate_count),
    selectedCount: Number(row.selected_count),
    contextHash: row.context_hash,
    policy: row.policy_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    items: itemRows.map(item => ({
      externalFileId: item.external_file_id,
      libraryFileId: item.library_file_id,
      versionId: item.version_id,
      sourcePath: item.source_path,
      rankNo: Number(item.rank_no),
      relevanceScore: item.relevance_score == null ? null : Number(item.relevance_score),
      selected: Boolean(item.selected),
      lineStart: item.line_start == null ? null : Number(item.line_start),
      lineEnd: item.line_end == null ? null : Number(item.line_end),
      contentHash: item.content_hash,
      metadata: item.metadata_json,
    })),
  };
};
