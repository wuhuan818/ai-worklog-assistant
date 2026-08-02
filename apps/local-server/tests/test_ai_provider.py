import os, sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from app.ai.router import ConnectionTestRequest, normalize_base_url, payload_for
import pytest

def request(provider='deepseek', **kwargs):
    return ConnectionTestRequest(provider=provider, base_url='https://api.example.com/v1/', model='model', api_key='synthetic-secret-never-log', **kwargs)

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
