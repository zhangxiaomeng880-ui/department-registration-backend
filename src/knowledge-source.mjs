import { randomUUID } from 'node:crypto';
import { getRuntimePool } from './runtime-db.mjs';

const jsonValue = value => value == null ? null : JSON.stringify(value);

export const normalizeChatGptLibraryDocument = input => {
  if (!input?.file_id && !input?.library_file_id) {
    const error = new Error('file_id or library_file_id is required');
    error.code = 'INVALID_LIBRARY_DOCUMENT';
    error.statusCode = 400;
    throw error;
  }

  return {
    externalFileId: input.file_id || input.library_file_id,
    libraryFileId: input.library_file_id || null,
    versionId: input.version_id == null ? null : String(input.version_id),
    versionNumber: input.current_version_number == null ? null : Number(input.current_version_number),
    sourcePath: input.library_path || input.path || null,
    name: input.name || input.library_path || input.path || input.file_id || input.library_file_id,
    mimeType: input.mime_type || null,
    fileProvider: input.file_provider || 'native',
    sourceModifiedAt: input.modified_at || null,
    sourceStatus: input.source_status || null,
    defaultRetrieval: input.default_retrieval === true,
    contentFingerprint: input.content_fingerprint || null,
    metadata: input.metadata || null,
  };
};

export const registerKnowledgeSource = async input => {
  if (!input?.sourceKey || !input?.provider) {
    const error = new Error('sourceKey and provider are required');
    error.code = 'INVALID_KNOWLEDGE_SOURCE';
    error.statusCode = 400;
    throw error;
  }

  const db = getRuntimePool();
  const id = input.id || randomUUID();
  await db.execute(
    `INSERT INTO knowledge_sources (
      id, source_key, provider, source_type, transport_mode,
      status, root_scope, config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      provider = VALUES(provider),
      source_type = VALUES(source_type),
      transport_mode = VALUES(transport_mode),
      status = VALUES(status),
      root_scope = VALUES(root_scope),
      config_json = VALUES(config_json),
      updated_at = CURRENT_TIMESTAMP(6)`,
    [
      id,
      input.sourceKey,
      input.provider,
      input.sourceType || 'LIBRARY',
      input.transportMode || 'CHATGPT_TOOL',
      input.status || 'ACTIVE',
      input.rootScope || null,
      jsonValue(input.config || null),
    ]
  );

  const [rows] = await db.execute(
    'SELECT id, source_key, provider, source_type, transport_mode, status, root_scope FROM knowledge_sources WHERE source_key = ? LIMIT 1',
    [input.sourceKey]
  );
  const row = rows[0];
  return {
    id: row.id,
    sourceKey: row.source_key,
    provider: row.provider,
    sourceType: row.source_type,
    transportMode: row.transport_mode,
    status: row.status,
    rootScope: row.root_scope,
  };
};

export const syncKnowledgeMetadata = async input => {
  if (!input?.sourceKey || !Array.isArray(input.documents)) {
    const error = new Error('sourceKey and documents[] are required');
    error.code = 'INVALID_KNOWLEDGE_SYNC';
    error.statusCode = 400;
    throw error;
  }

  const db = getRuntimePool();
  const connection = await db.getConnection();
  const syncId = input.syncId || randomUUID();

  try {
    await connection.beginTransaction();

    const [sourceRows] = await connection.execute(
      'SELECT id FROM knowledge_sources WHERE source_key = ? AND status = \'ACTIVE\' LIMIT 1 FOR UPDATE',
      [input.sourceKey]
    );
    if (!sourceRows.length) {
      const error = new Error('Knowledge source not found or inactive');
      error.code = 'KNOWLEDGE_SOURCE_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    const sourceId = sourceRows[0].id;
    await connection.execute(
      `INSERT INTO knowledge_sync_runs (
        id, source_id, run_id, status, discovered_count, started_at
      ) VALUES (?, ?, ?, 'RUNNING', ?, CURRENT_TIMESTAMP(6))`,
      [syncId, sourceId, input.runId || null, input.documents.length]
    );

    let changedCount = 0;
    let unchangedCount = 0;

    for (const raw of input.documents) {
      const doc = input.provider === 'chatgpt_library' || !input.provider
        ? normalizeChatGptLibraryDocument(raw)
        : raw;

      const [existingRows] = await connection.execute(
        `SELECT id, current_version_id, content_fingerprint
         FROM knowledge_documents
         WHERE source_id = ? AND external_file_id = ?
         LIMIT 1`,
        [sourceId, doc.externalFileId]
      );

      const existing = existingRows[0];
      const changed = !existing ||
        String(existing.current_version_id ?? '') !== String(doc.versionId ?? '') ||
        String(existing.content_fingerprint ?? '') !== String(doc.contentFingerprint ?? '');

      if (changed) changedCount += 1;
      else unchangedCount += 1;

      const documentId = existing?.id || randomUUID();
      await connection.execute(
        `INSERT INTO knowledge_documents (
          id, source_id, external_file_id, library_file_id, source_path,
          name, mime_type, file_provider, source_status, default_retrieval,
          current_version_id, current_version_number, source_modified_at,
          content_fingerprint, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          library_file_id = VALUES(library_file_id),
          source_path = VALUES(source_path),
          name = VALUES(name),
          mime_type = VALUES(mime_type),
          file_provider = VALUES(file_provider),
          source_status = VALUES(source_status),
          default_retrieval = VALUES(default_retrieval),
          current_version_id = VALUES(current_version_id),
          current_version_number = VALUES(current_version_number),
          source_modified_at = VALUES(source_modified_at),
          content_fingerprint = VALUES(content_fingerprint),
          metadata_json = VALUES(metadata_json),
          updated_at = CURRENT_TIMESTAMP(6)`,
        [
          documentId,
          sourceId,
          doc.externalFileId,
          doc.libraryFileId || null,
          doc.sourcePath || null,
          doc.name,
          doc.mimeType || null,
          doc.fileProvider || null,
          doc.sourceStatus || null,
          doc.defaultRetrieval === true,
          doc.versionId || null,
          doc.versionNumber || null,
          doc.sourceModifiedAt ? new Date(doc.sourceModifiedAt) : null,
          doc.contentFingerprint || null,
          jsonValue(doc.metadata || null),
        ]
      );
    }

    await connection.execute(
      `UPDATE knowledge_sync_runs
       SET status = 'PASS',
           changed_count = ?,
           unchanged_count = ?,
           finished_at = CURRENT_TIMESTAMP(6),
           summary_json = ?
       WHERE id = ?`,
      [
        changedCount,
        unchangedCount,
        jsonValue({ sourceKey: input.sourceKey, provider: input.provider || 'chatgpt_library' }),
        syncId,
      ]
    );

    await connection.commit();
    return {
      syncId,
      sourceKey: input.sourceKey,
      discoveredCount: input.documents.length,
      changedCount,
      unchangedCount,
      status: 'PASS',
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const listKnowledgeDocuments = async input => {
  if (!input?.sourceKey) {
    const error = new Error('sourceKey is required');
    error.code = 'INVALID_KNOWLEDGE_QUERY';
    error.statusCode = 400;
    throw error;
  }

  const db = getRuntimePool();
  const params = [input.sourceKey];
  const clauses = ['s.source_key = ?'];

  if (input.defaultRetrieval !== undefined) {
    clauses.push('d.default_retrieval = ?');
    params.push(input.defaultRetrieval === true);
  }
  if (input.sourceStatus) {
    clauses.push('d.source_status = ?');
    params.push(input.sourceStatus);
  }

  const [rows] = await db.execute(
    `SELECT
       d.id, d.external_file_id, d.library_file_id, d.source_path,
       d.name, d.mime_type, d.file_provider, d.source_status,
       d.default_retrieval, d.current_version_id, d.current_version_number,
       d.source_modified_at, d.content_fingerprint,
       d.last_indexed_version_id, d.last_indexed_at
     FROM knowledge_documents d
     JOIN knowledge_sources s ON s.id = d.source_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY d.source_path, d.name`,
    params
  );

  return rows.map(row => ({
    id: row.id,
    externalFileId: row.external_file_id,
    libraryFileId: row.library_file_id,
    sourcePath: row.source_path,
    name: row.name,
    mimeType: row.mime_type,
    fileProvider: row.file_provider,
    sourceStatus: row.source_status,
    defaultRetrieval: Boolean(row.default_retrieval),
    versionId: row.current_version_id,
    versionNumber: row.current_version_number == null ? null : Number(row.current_version_number),
    sourceModifiedAt: row.source_modified_at,
    contentFingerprint: row.content_fingerprint,
    lastIndexedVersionId: row.last_indexed_version_id,
    lastIndexedAt: row.last_indexed_at,
    needsReindex:
      String(row.current_version_id ?? '') !== String(row.last_indexed_version_id ?? ''),
  }));
};
