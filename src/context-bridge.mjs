import { createHash, randomUUID } from 'node:crypto';

const packets = new Map();
const MAX_ITEMS = 24;
const MAX_TOTAL_CHARS = 240000;
const DEFAULT_ALLOWED_STATUSES = new Set(['CURRENT','FACT','RULE','FINAL']);

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

const nowMs = () => Date.now();

const sanitizeMetadata = packet => ({
  id: packet.id,
  createdAt: packet.createdAt,
  expiresAt: packet.expiresAt,
  queryHash: packet.queryHash,
  scope: packet.scope,
  itemCount: packet.items.length,
  contextHash: packet.contextHash,
  consumed: packet.consumed,
});

const purgeExpired = () => {
  const now = nowMs();
  for (const [id, packet] of packets.entries()) {
    if (packet.expiresAtMs <= now || packet.consumed) {
      packets.delete(id);
    }
  }
};

export const createEphemeralContextPacket = input => {
  purgeExpired();

  if (!input?.query || !Array.isArray(input?.items) || !input.items.length) {
    const error = new Error('query and items[] are required');
    error.code = 'INVALID_CONTEXT_PACKET';
    error.statusCode = 400;
    throw error;
  }

  if (input.items.length > MAX_ITEMS) {
    const error = new Error(`Context packet supports at most ${MAX_ITEMS} items`);
    error.code = 'CONTEXT_PACKET_TOO_MANY_ITEMS';
    error.statusCode = 413;
    throw error;
  }

  const ttlSeconds = Math.max(30, Math.min(Number(input.ttlSeconds || 300), 1800));
  const normalizedItems = input.items.map((item, index) => {
    if (!item?.sourceFileId || !item?.sourceText) {
      const error = new Error(`Context item ${index + 1} requires sourceFileId and sourceText`);
      error.code = 'INVALID_CONTEXT_ITEM';
      error.statusCode = 400;
      throw error;
    }
    const sourceStatus = item.sourceStatus || 'CURRENT';
    if (!DEFAULT_ALLOWED_STATUSES.has(sourceStatus)) {
      const error = new Error(`Context item ${index + 1} status ${sourceStatus} is not allowed for default execution`);
      error.code = 'CONTEXT_SOURCE_STATUS_NOT_ALLOWED';
      error.statusCode = 409;
      throw error;
    }
    return {
      sourceFileId: item.sourceFileId,
      sourceLibraryFileId: item.sourceLibraryFileId || null,
      sourceVersion: item.sourceVersion || null,
      sourcePath: item.sourcePath || null,
      sourceStatus,
      lineStart: item.lineStart == null ? null : Number(item.lineStart),
      lineEnd: item.lineEnd == null ? null : Number(item.lineEnd),
      contentSha256: sha256(item.sourceText),
      sourceText: item.sourceText,
    };
  });

  const totalChars = normalizedItems.reduce((sum, item) => sum + item.sourceText.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    const error = new Error(`Context packet exceeds ${MAX_TOTAL_CHARS} characters`);
    error.code = 'CONTEXT_PACKET_TOO_LARGE';
    error.statusCode = 413;
    throw error;
  }

  const id = input.id || randomUUID();
  const createdAtMs = nowMs();
  const packet = {
    id,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + ttlSeconds * 1000).toISOString(),
    expiresAtMs: createdAtMs + ttlSeconds * 1000,
    query: input.query,
    queryHash: sha256(input.query),
    scope: input.scope || null,
    precedence: Array.isArray(input.precedence) ? input.precedence : [],
    items: normalizedItems,
    contextHash: sha256(JSON.stringify(normalizedItems.map(item => ({
      sourceFileId: item.sourceFileId,
      sourceLibraryFileId: item.sourceLibraryFileId,
      sourceVersion: item.sourceVersion,
      sourcePath: item.sourcePath,
      sourceStatus: item.sourceStatus,
      lineStart: item.lineStart,
      lineEnd: item.lineEnd,
      contentSha256: item.contentSha256,
    })))),
    consumed: false,
  };

  packets.set(id, packet);
  return sanitizeMetadata(packet);
};

export const getEphemeralContextPacketMetadata = id => {
  purgeExpired();
  const packet = packets.get(id);
  if (!packet) {
    const error = new Error('Context packet not found or expired');
    error.code = 'CONTEXT_PACKET_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  return sanitizeMetadata(packet);
};

export const consumeEphemeralContextPacket = id => {
  purgeExpired();
  const packet = packets.get(id);
  if (!packet) {
    const error = new Error('Context packet not found or expired');
    error.code = 'CONTEXT_PACKET_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (packet.consumed) {
    const error = new Error('Context packet already consumed');
    error.code = 'CONTEXT_PACKET_ALREADY_CONSUMED';
    error.statusCode = 409;
    throw error;
  }
  packet.consumed = true;
  packets.delete(id);

  return {
    id: packet.id,
    query: packet.query,
    queryHash: packet.queryHash,
    scope: packet.scope,
    precedence: packet.precedence,
    contextHash: packet.contextHash,
    items: packet.items.map(item => ({ ...item })),
  };
};

export const clearEphemeralContextPackets = () => {
  packets.clear();
};
