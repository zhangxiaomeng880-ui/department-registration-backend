# Knowledge Source Adapter Contract V1.0

Status: IMPLEMENTED CONTRACT / CONNECTOR EXECUTION PENDING

## Goal

Keep ChatGPT Library as the single source of truth for project knowledge. Runtime stores only source/version/index metadata. It must not require a second manually maintained copy of screenplay, character, timeline, visual, diary, OST, or production documents in Git.

## ChatGPT Library mapping

The adapter normalizes Library metadata into this contract:

- `file_id` -> `externalFileId`
- `library_file_id` -> `libraryFileId`
- `version_id` -> `versionId`
- `library_path` -> `sourcePath`
- `name` -> `name`
- `mime_type` -> `mimeType`
- `file_provider` -> `fileProvider`
- `modified_at` -> `sourceModifiedAt`

## Single-source rule

1. Source content lives in ChatGPT Library.
2. Git stores adapter/schema/retrieval rules only.
3. MySQL stores document identity, version and index status only.
4. RAG stores derived chunks/embeddings only.
5. No human is required to maintain a duplicate screenplay or knowledge copy in Git.
6. When `versionId` or source fingerprint changes, only that document is eligible for re-index.
7. If Library CURRENT index says an asset is not default retrieval, it must not enter ordinary retrieval unless explicitly requested.

## Connector boundary

The Node runtime does not own ChatGPT Library credentials. Library list/search/read is performed by the connected ChatGPT connector/tool layer. The connector sends normalized metadata/content into Runtime through the adapter boundary. This keeps source access permissions outside the backend and prevents copying source-of-truth ownership into Runtime.

## Adapter interface

Required operations:

- `list(scope)`
- `search(query, scope)`
- `read(documentRef, versionId?)`
- `getMetadata(documentRef)`
- `syncMetadata(documents)`

Step 2.1 implements the normalized metadata contract and sync state.
Step 2.2 will consume `read()` output to generate chunks and index them without persisting a second canonical document copy.
