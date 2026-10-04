# Ephemeral Context Bridge V1.0

Status: IMPLEMENTED / CI VALIDATION REQUIRED

## Purpose

Bridge ChatGPT Library retrieval and Runtime Agent execution without copying canonical project knowledge into Git or MySQL.

## Data lifecycle

1. ChatGPT Library remains the canonical source.
2. Library search/read happens outside the Node Runtime.
3. Selected source ranges are delivered as a short-lived Context Packet.
4. Runtime stores the packet in process memory only.
5. The packet has a TTL between 30 and 1800 seconds.
6. Agent execution consumes the packet once.
7. After consumption, the packet is deleted immediately.
8. Process restart also destroys all unconsumed packets.
9. Runtime evidence may persist source identifiers, versions, line ranges and hashes, but never source body.

## Security/continuity behavior

- Packet metadata endpoints never return source body.
- Context Packet IDs are one-time execution handles.
- Consumed/expired packets return 404.
- Resume does not restore source body from MySQL; it requires re-fetching from the canonical Library source using recorded provenance.
- This preserves the single-source rule and prevents hidden duplicate knowledge stores.

## Current architecture

ChatGPT Library
-> search/read
-> Ephemeral Context Packet
-> Runtime Router P86
-> Script Agent
-> Model Provider
-> Gate / QA / Checkpoint

Git stores only implementation and policy.
MySQL stores only execution/provenance/fingerprints.
