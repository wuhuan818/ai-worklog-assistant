import os, sys, asyncio
import httpx
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.ai.router import ConnectionTestRequest, normalize_base_url, payload_for
import app.ai.router as router
import pytest

def request(provider='deepseek', **kwargs):
    data = {'provider': provider, 'base_url': 'https://api.example.com/v1/', 'model': 'model', 'api_key': 'synthetic-secret-never-log'}
    data.update(kwargs)
    return ConnectionTestRequest(**data)

def test_url_normalization_and_security():
    assert normalize_base_url('https://example.com/v1///') == 'https://example.com/v1'
    assert normalize_base_url('http://localhost:9999/v1') == 'http://localhost:9999/v1'
    for value in ('http://example.com', 'https://user:pass@example.com', 'https://example.com/v1?key=x', 'https://example.com/chat/completions'):
        with pytest.raises(ValueError): normalize_base_url(value)

def test_provider_payload_mappings_have_no_secret():
    deepseek = payload_for(request(thinking_enabled=False))
    assert deepseek['thinking'] == {'type': 'disabled'} and deepseek['max_tokens'] == 16
    qwen = payload_for(request('qwen', thinking_enabled=False))
    assert qwen['enable_thinking'] is False
    custom = payload_for(request('openai-compatible'))
    assert 'thinking' not in custom and 'enable_thinking' not in custom
    assert 'synthetic-secret-never-log' not in str(deepseek)

def test_connection_contract_never_sends_work_data_or_returns_secret(monkeypatch):
    captured = {}
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def post(self, url, json, headers):
            captured.update(url=url, payload=json, headers=headers)
            return httpx.Response(200, json={'choices': [{'message': {'content': 'OK'}}]})
    monkeypatch.setattr(router.httpx, 'AsyncClient', lambda **kwargs: Client())
    import app.main as main
    main.TOKEN = 'session'
    result = asyncio.run(router.test_connection(request(api_key='synthetic-secret-never-log'), authorization='Bearer session'))
    assert result['ok'] and 'synthetic-secret-never-log' not in str(result)
    assert captured['payload']['messages'] == [{'role': 'system', 'content': 'Return a short connection-test response.'}, {'role': 'user', 'content': 'Reply with OK.'}]
    assert 'task' not in str(captured['payload']).lower() and captured['headers']['Authorization'] == 'Bearer synthetic-secret-never-log'

@pytest.mark.parametrize('status,category', [(401, 'unauthorized'), (403, 'forbidden'), (404, 'model_not_found'), (429, 'rate_limited'), (500, 'provider_error')])
def test_connection_http_errors_are_classified_and_redacted(monkeypatch, status, category):
    class Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return None
        async def post(self, *args, **kwargs): return httpx.Response(status, content=b'<html>secret response</html>')
    monkeypatch.setattr(router.httpx, 'AsyncClient', lambda **kwargs: Client())
    import app.main as main
    main.TOKEN = 'session'
    with pytest.raises(Exception) as error: asyncio.run(router.test_connection(request(api_key='synthetic-secret-never-log'), authorization='Bearer session'))
    assert category in str(error.value) and 'synthetic-secret-never-log' not in str(error.value) and 'secret response' not in str(error.value)
