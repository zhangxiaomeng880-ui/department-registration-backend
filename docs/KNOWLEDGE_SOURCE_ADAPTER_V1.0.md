# AI Native 2.0 Knowledge Source Adapter Contract V1.0

Status: IMPLEMENTATION BASELINE  
Primary source: ChatGPT Library  
Scope: 《你好，那年夏天》 first real validation project

## 1. Single-source rule

The authoritative project knowledge remains in ChatGPT Library.

Do not copy or manually maintain screenplay, character, timeline, visual, diary, OST, movie, or production knowledge in Git or MySQL.

- ChatGPT Library = authoritative knowledge body.
- Git = code, schema, retrieval policy, adapter contract, tests.
- MySQL = runtime state and immutable Run-level retrieval evidence.
- RAG/index = derived retrieval layer and may be rebuilt.

## 2. Manifest strategy

The Library CURRENT index and project execution entry act as the project manifest.

For 《你好，那年夏天》, retrieval starts from the CURRENT project entry / CURRENT baseline index, then follows only the assets selected by the task.

The manifest itself remains in Library. The runtime does not maintain a duplicate manifest.

## 3. Retrieval governance

Default allowed:
- CURRENT
- FINAL
- final QA / accepted QA
- formal production assets

Default excluded:
- historical-process materials
- superseded drafts
- historical copyright bundles
- non-production visual references
- failed / rejected generations
- Library root outside the project workspace

Conflict precedence is carried from the project manifest. The adapter must return an explicit precedence rank or role with each retrieved source.

## 4. ChatGPT-hosted adapter boundary

Ordinary external Node runtime does not directly read ChatGPT Library.

The ChatGPT execution layer performs:
1. Library search/read.
2. CURRENT/version/path resolution.
3. conflict-policy filtering.
4. task-scoped context selection.
5. POST of selected context and provenance to Runtime API.

The Node Runtime receives only the retrieved Run context. It does not become a second editable knowledge store.

## 5. Normalized source metadata

The adapter normalizes Library metadata:

- file_id -> sourceFileId
- library_file_id -> sourceLibraryFileId
- version_id -> sourceVersion
- library_path -> sourcePath
- name -> sourceName
- modified_at -> sourceModifiedAt

## 6. Runtime payload

POST /api/runtime/runs/:runId/knowledge-contexts

Each item contains:
- taskId (optional)
- sourceProvider = CHATGPT_LIBRARY
- sourceFileId
- sourceLibraryFileId (when available)
- sourceVersion
- sourcePath
- sourceName
- sourceModifiedAt
- sourceStatus
- precedenceRank
- retrievalQuery
- retrievalMode
- contextRole
- content

The server computes contentSha256. Clients do not provide trusted hashes.

## 7. Why content is persisted

Only the exact task-scoped context supplied to a Run is snapshotted.

This is execution evidence, not a maintained copy of the knowledge base. It exists so a historical Run can explain:
- which Library file/version it used;
- exactly what context was supplied;
- whether a later source update invalidates Resume/replay.

No user manually edits these snapshots.

## 8. Minimum acceptance

PASS when:
- Runtime API accepts Library-derived context with provenance.
- Runtime computes SHA-256 and stores the immutable context snapshot.
- Run context can be queried back by run_id.
- duplicate manual knowledge maintenance is not introduced.
- existing Runtime Persistence / Resume tests continue to pass.
