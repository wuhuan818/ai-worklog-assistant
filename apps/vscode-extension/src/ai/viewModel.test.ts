import test from 'node:test';
import assert from 'node:assert/strict';
import { aiViewModel } from './viewModel';
test('AI ViewModel never exposes secrets or URL query parameters', () => { const view = aiViewModel({ id:'p', displayName:'P', provider:'qwen', baseUrl:'https://example.com/v1?workspace=private', model:'qwen3.7-plus', thinkingEnabled:false, timeoutSeconds:30, maxOutputTokens:16, createdAt:'x', updatedAt:'x' }, true, 'connected', '2026-08-02'); assert.equal(view.apiKey, '已配置'); assert.equal(view.endpoint, 'https://example.com/v1'); assert.equal(JSON.stringify(view).includes('private'), false); });
