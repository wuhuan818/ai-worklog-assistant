"""Offline Stage 11A verification against the real packaged backend executable."""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / "artifacts" / "backend" / "ai-worklog-server.exe"


def port() -> int:
    with socket.socket() as value:
        value.bind(("127.0.0.1", 0))
        return value.getsockname()[1]


def request(url: str, token: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def start(data_dir: Path, token: str, listen_port: int) -> tuple[subprocess.Popen, float]:
    environment = {**os.environ, "AI_WORKLOG_DATA_DIR": str(data_dir), "WORKLOG_DB": str(data_dir / "worklog.db"), "WORKLOG_KNOWLEDGE": str(data_dir / "knowledge"), "WORKLOG_PORT": str(listen_port), "WORKLOG_SESSION_TOKEN": token}
    began = time.perf_counter()
    process = subprocess.Popen([str(EXE)], cwd=ROOT, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            request(f"http://127.0.0.1:{listen_port}/health", token)
            return process, (time.perf_counter() - began) * 1000
        except Exception:
            time.sleep(0.25)
    process.terminate()
    raise RuntimeError("packaged backend did not become healthy")


def stop(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=8)
        except subprocess.TimeoutExpired: process.kill()


def main() -> None:
    if not EXE.exists(): raise RuntimeError(f"missing packaged backend: {EXE}")
    with tempfile.TemporaryDirectory(prefix="ai-worklog-stage11-") as raw:
        data_dir = Path(raw); token = "stage11-" + uuid.uuid4().hex
        os.environ.update(AI_WORKLOG_DATA_DIR=str(data_dir), WORKLOG_DB=str(data_dir / "worklog.db"), WORKLOG_KNOWLEDGE=str(data_dir / "knowledge"))
        sys.path.insert(0, str(ROOT / "apps" / "local-server"))
        import app.main as source_main
        connection = source_main.db()
        baseline = [
            ("published-login", "task-a", "revision-a", 0, "登录 Android 指南", "开发", "使用 SQLite 保存登录 API token，并处理登录 Bug。", "适用于 Android 登录与 API 排障。", "published/development/login.md", "hash-login", "published", "2026-08-07T00:00:00+00:00", "2026-08-07T00:00:00+00:00", "2026-08-07T00:00:00+00:00", None),
            ("published-vscode", "task-b", "revision-b", 0, "VS Code API 构建", "工程", "使用 npm 编译 TypeScript API client。", "适用于 VS Code 扩展构建。", "published/engineering/vscode.md", "hash-vscode", "published", "2026-08-06T00:00:00+00:00", "2026-08-06T00:00:00+00:00", "2026-08-06T00:00:00+00:00", None),
            ("superseded-login", "task-a", "revision-old", 0, "旧登录方案", "开发", "登录旧内容不应返回。", "已被替代。", "published/development/old.md", "hash-old", "superseded", "2026-08-05T00:00:00+00:00", "2026-08-07T00:00:00+00:00", "2026-08-05T00:00:00+00:00", "2026-08-07T00:00:00+00:00"),
        ]
        bulk = [(f"bulk-{index:04d}", f"task-{index}", f"revision-{index}", 0, f"工程知识 {index}", "性能", f"SQLite retrieval benchmark entry {index}", "deterministic local indexing", f"published/perf/{index}.md", f"hash-{index}", "published", "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00", "2026-08-01T00:00:00+00:00", None) for index in range(1000)]
        from app.ai.retrieval import service as retrieval
        connection.executemany("INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", baseline + bulk[:98])
        began = time.perf_counter(); retrieval.reconcile(connection, force=True); index_100_ms = (time.perf_counter() - began) * 1000
        connection.executemany("INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", bulk[98:])
        began = time.perf_counter(); retrieval.reconcile(connection, force=True); index_1000_ms = (time.perf_counter() - began) * 1000
        connection.close()
        first_port = port(); process, first_start_ms = start(data_dir, token, first_port)
        try:
            health = request(f"http://127.0.0.1:{first_port}/health", token)
            def search(query: str, category: str | None = None) -> list[dict]:
                parameters = {"q": query, "limit": "10"}
                if category: parameters["category"] = category
                started = time.perf_counter(); result = request(f"http://127.0.0.1:{first_port}/knowledge/search?{urllib.parse.urlencode(parameters)}", token)["items"]
                return result, (time.perf_counter() - started) * 1000
            chinese, chinese_ms = search("登录")
            english, _ = search("Android API")
            filtered, _ = search("VS Code", "工程")
            performance, performance_ms = search("SQLite retrieval")
            assert "knowledge-retrieval-v1" in health["features"]
            assert chinese[0]["publication_id"] == "published-login" and chinese[0]["source_ref"] == "knowledge-publication:published-login"
            assert english[0]["publication_id"] == "published-login" and filtered[0]["publication_id"] == "published-vscode"
            assert all(item["publication_id"] != "superseded-login" for item in chinese)
            assert len(performance) == 10
        finally: stop(process)
        second_port = port(); process, restart_ms = start(data_dir, token, second_port)
        try:
            restored = request(f"http://127.0.0.1:{second_port}/knowledge/search?q={urllib.parse.quote('登录')}", token)["items"]
            assert restored[0]["publication_id"] == "published-login"
        finally: stop(process)
        print(json.dumps({"status": "PASS", "feature": "knowledge-retrieval-v1", "publications": 1002, "index_100_ms": round(index_100_ms, 1), "index_1000_ms": round(index_1000_ms, 1), "first_start_and_reconcile_ms": round(first_start_ms, 1), "restart_ms": round(restart_ms, 1), "chinese_query_ms": round(chinese_ms, 1), "top_k_query_1000_ms": round(performance_ms, 1), "chinese_title": chinese[0]["title"], "restart_result": restored[0]["publication_id"]}, ensure_ascii=False))


if __name__ == "__main__": main()
