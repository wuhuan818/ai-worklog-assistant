# Stage 11A — Knowledge Retrieval Foundation

Published `knowledge_publications` are the only source.  Startup reconciliation and publication both rebuild `knowledge_search_index`; drafts, reviews, prompts, provider responses, absolute paths, and superseded publications are excluded.

This Windows runtime has no SQLite FTS5 module, so the implementation uses a compact persistent SQLite lexical index.  It stores normalized title, category, summary, and reusable-reason fields plus safe provenance metadata. Chinese text is indexed as individual CJK characters and adjacent bigrams; Latin terms are case-folded words. This supports short Chinese queries such as `登录`, English terms such as `SQLite`, and mixed queries such as `Android API`, without NLP packages, models, secrets, or network calls.

`GET /knowledge/search?q=<query>&limit=10&category=<optional>` returns ranked, stable results with `publication_id`, `source_ref`, safe logical path, snippet, score/rank, publication time, task id, and revision id. Query length is limited to 200, limit is 1–50, and every SQL value is parameterized. Higher title matches score above category/reusable reason/content matches. Result opening resolves the logical path beneath the managed knowledge root.

Rebuilding is deterministic (`reconcile(connection, force=True)`), reads published rows only, and never changes publication rows or Markdown. Stage 11B may consume the `source_ref` contract for RAG citations; embeddings and semantic retrieval remain out of scope.
