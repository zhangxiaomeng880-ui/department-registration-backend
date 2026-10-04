import {
  registerKnowledgeSource,
  syncKnowledgeMetadata,
  listKnowledgeDocuments,
} from './knowledge-source.mjs';
import {
  recordKnowledgeRetrieval,
  getKnowledgeRetrieval,
} from './knowledge-retrieval.mjs';

export const handleKnowledgeRoute = async (req, res, url, helpers) => {
  const { json, readBody } = helpers;
  if (!url.pathname.startsWith('/api/runtime/knowledge/')) return false;

  if (req.method === 'POST' && url.pathname === '/api/runtime/knowledge/sources') {
    const result = await registerKnowledgeSource(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/knowledge/sync-metadata') {
    const result = await syncKnowledgeMetadata(await readBody(req));
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/knowledge/retrievals') {
    const result = await recordKnowledgeRetrieval(await readBody(req));
    json(res, 201, { data: result });
    return true;
  }

  const retrievalMatch = url.pathname.match(/^\/api\/runtime\/knowledge\/retrievals\/([^/]+)$/);
  if (req.method === 'GET' && retrievalMatch) {
    const result = await getKnowledgeRetrieval(retrievalMatch[1]);
    json(res, 200, { data: result });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/runtime/knowledge/documents') {
    const sourceKey = url.searchParams.get('sourceKey');
    const sourceStatus = url.searchParams.get('sourceStatus') || undefined;
    const defaultRetrievalRaw = url.searchParams.get('defaultRetrieval');
    const defaultRetrieval = defaultRetrievalRaw == null
      ? undefined
      : defaultRetrievalRaw === 'true';

    const result = await listKnowledgeDocuments({
      sourceKey,
      sourceStatus,
      defaultRetrieval,
    });
    json(res, 200, { data: result });
    return true;
  }

  json(res, 404, { error: 'KNOWLEDGE_ROUTE_NOT_FOUND' });
  return true;
};
