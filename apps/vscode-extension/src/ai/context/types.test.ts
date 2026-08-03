import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultBuildConfig, validBudget } from './types';
test('context defaults are provider-free and use the v1 32000 budget', () => { const config = defaultBuildConfig(); assert.equal(config.schema_version, 'context-build-config/v1'); assert.equal(config.estimated_input_token_budget, 32000); assert.equal('api_key' in config, false); });
test('context budget setting is constrained to the documented range', () => { assert.equal(validBudget(4000), 4000); assert.equal(validBudget(128000), 128000); assert.equal(validBudget(3999), 32000); });
