from __future__ import annotations

import re
import sqlite3
from typing import Any


class RetrievalError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


_WORD = re.compile(r"[a-z0-9_]+", re.I)


def searchable(value: str) -> str:
    """Latin terms plus CJK unigrams/bigrams: no model or external service."""
    value = value.casefold()
    words = _WORD.findall(value)
    cjk: list[str] = []
    for run in re.findall(r"[\u3400-\u9fff]+", value):
        cjk.extend(run)
        cjk.extend(run[i:i + 2] for i in range(len(run) - 1))
    return " ".join(words + cjk)


def ensure_schema(c: sqlite3.Connection) -> None:
    # The bundled Windows SQLite does not reliably provide FTS5.  A compact
    # normal table is portable in both source and packaged runtimes.
    c.execute("""CREATE TABLE IF NOT EXISTS knowledge_search_index(
      publication_id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
      summary TEXT NOT NULL, reusable_reason TEXT NOT NULL, task_id TEXT NOT NULL,
      revision_id TEXT NOT NULL, published_at TEXT NOT NULL, content_hash TEXT NOT NULL,
      logical_path TEXT NOT NULL)""")
    c.execute("CREATE INDEX IF NOT EXISTS ix_knowledge_search_index_published ON knowledge_search_index(published_at DESC)")


def reconcile(c: sqlite3.Connection, force: bool = False) -> int:
    """Safely rebuild solely from active publications; publication rows are untouched."""
    ensure_schema(c)
    rows = c.execute("SELECT id,task_id,revision_id,title,category,summary,why_reusable,published_at,content_hash,logical_path FROM knowledge_publications WHERE status='published' ORDER BY published_at,id").fetchall()
    if not force and c.execute("SELECT COUNT(*) FROM knowledge_search_index").fetchone()[0] == len(rows):
        return len(rows)
    c.execute("DELETE FROM knowledge_search_index")
    c.executemany("INSERT INTO knowledge_search_index VALUES (?,?,?,?,?,?,?,?,?,?)", [
        (row['id'], searchable(row['title']), searchable(row['category']), searchable(row['summary']), searchable(row['why_reusable']), row['task_id'], row['revision_id'], row['published_at'], row['content_hash'], row['logical_path']) for row in rows
    ])
    return len(rows)


def index_publications(c: sqlite3.Connection, publication_ids: list[str]) -> None:
    if publication_ids:
        reconcile(c, force=True)


def _snippet(row: sqlite3.Row, query: str) -> str:
    text = f"{row['summary']} {row['why_reusable']}".strip()
    terms = [term for term in re.split(r"\s+", query.strip()) if term]
    pos = min((text.casefold().find(term.casefold()) for term in terms if text.casefold().find(term.casefold()) >= 0), default=0)
    start, end = max(0, pos - 55), min(len(text), pos + 165)
    return ("…" if start else "") + text[start:end].replace("<", "＜").replace(">", "＞") + ("…" if end < len(text) else "")


def search(c: sqlite3.Connection, query: str, limit: int = 10, category: str | None = None) -> list[dict[str, Any]]:
    query = query.strip()
    if not query: raise RetrievalError('query_required', 'Search query is required')
    if len(query) > 200: raise RetrievalError('query_too_long', 'Search query must be 200 characters or fewer')
    tokens = searchable(query).split()
    if not tokens: return []
    sql = """SELECT p.*, i.title AS indexed_title, i.category AS indexed_category,
      i.summary AS indexed_summary, i.reusable_reason AS indexed_reusable
      FROM knowledge_search_index i JOIN knowledge_publications p ON p.id=i.publication_id
      WHERE p.status='published'"""
    params: list[Any] = []
    for token in tokens:
        sql += " AND (i.title LIKE ? OR i.category LIKE ? OR i.summary LIKE ? OR i.reusable_reason LIKE ?)"
        params.extend([f'%{token}%'] * 4)
    if category: sql += " AND p.category=?"; params.append(category)
    rows = c.execute(sql, params).fetchall()
    def score(row: sqlite3.Row) -> int:
        return sum(weight * sum(field.count(token) for token in tokens) for field, weight in ((row['indexed_title'], 8), (row['indexed_category'], 2), (row['indexed_reusable'], 2), (row['indexed_summary'], 1)))
    ranked = sorted(rows, key=lambda row: (-score(row), row['published_at'], row['id']))[:limit]
    return [{'publication_id': row['id'], 'title': row['title'], 'category': row['category'], 'snippet': _snippet(row, query), 'score': score(row), 'rank': index + 1, 'published_at': row['published_at'], 'source_ref': f"knowledge-publication:{row['id']}", 'task_id': row['task_id'], 'revision_id': row['revision_id'], 'logical_path': row['logical_path']} for index, row in enumerate(ranked)]
