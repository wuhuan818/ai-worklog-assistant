# Stage 11B — Semantic / Hybrid Retrieval and grounded answers

Stage 11A local lexical retrieval remains unchanged. Stage 11B adds an explicitly configured, independently stored Embedding Profile for Qwen or Custom OpenAI-compatible `/embeddings` endpoints. Its key stays in VS Code SecretStorage and is supplied only for an individual connection test, index build, retrieval, or answer request; it is never written to SQLite or logs.

Semantic vectors are non-authoritative rebuildable metadata in SQLite (`knowledge_embedding_chunks`), encoded as validated little-endian float32. The index derives only from current published knowledge and uses deterministic title/category/summary/reusable-reason chunks plus a safe model/config/chunking fingerprint. Superseded publications are excluded.

Hybrid retrieval uses reciprocal-rank fusion of lexical and cosine candidates. Missing or unavailable semantic infrastructure explicitly falls back to lexical retrieval. RAG uses only retrieved published sources, validates every model citation against the retrieval source refs, and neither persists prompt, raw response, reasoning content, question, nor answer history.

External boundary: enabling/building a semantic index sends published knowledge to the configured embedding provider. Asking the knowledge base sends the user question and retrieved published snippets to the explicitly selected chat provider. Local Stage 11A keyword search does neither.
