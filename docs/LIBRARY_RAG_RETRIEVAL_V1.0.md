# Library RAG Retrieval Contract V1.0

Status: IMPLEMENTED CONTRACT

## Decision

For ChatGPT Library sources, AI Native uses Library native semantic search/read as the first retrieval engine. A separate vector database is not required for this source at the current stage.

This avoids:
- duplicating canonical project content;
- maintaining a second embedding/index pipeline for data already searchable in Library;
- syncing screenplay/facts manually between Library and Git.

## Retrieval path

1. Resolve the project's CURRENT execution entry.
2. Search Library within the project scope.
3. Prefer CURRENT/default-retrieval assets according to project precedence.
4. Read exact source ranges needed for the task.
5. Build a transient Context Packet.
6. Pass the packet to Agent/Skill.
7. Persist only provenance, versions, line ranges and hashes.

## Context Packet

Transient only:

- query
- selected source text
- precedence
- source identity
- version identity
- line/page range
- retrieval reason

Persisted:

- retrieval id
- source/document ids
- external file id / library file id
- version id
- source path
- rank / score when provided
- selected flag
- line/page range when available
- content hash
- context hash

The retrieved text itself is not stored in MySQL as a second canonical copy.

## Conflict precedence

For 《你好，那年夏天》, the project execution entry defines:

author latest explicit confirmation
> story fact baseline
> continuous master screenplay
> timeline/structure baseline
> specialist CURRENT
> original source
> history/process log
> temporary generation

Retrieval must preserve this precedence instead of treating all matches as equal.

## Step 2.2 acceptance

PASS requires:
- real Library search resolves CURRENT assets;
- exact source ranges can be read/found;
- Runtime can record retrieval provenance without storing source body;
- retrieval evidence includes source version;
- existing Runtime/MySQL tests remain PASS.
