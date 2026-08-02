import test from 'node:test';
import assert from 'node:assert/strict';
import { AiConnectionStateStore } from './connectionState';

const profile = { id:'p', displayName:'P', provider:'deepseek' as const, baseUrl:'https://api.deepseek.com', model:'m', thinkingEnabled:false, timeoutSeconds:30, maxOutputTokens:16, createdAt:'x', updatedAt:'x' };
test('AI connection state is versioned, profile-scoped, and resets for a new runtime', () => { const state = new AiConnectionStateStore(); assert.equal(state.forProfile(undefined).connection, 'not-configured'); assert.equal(state.forProfile(profile).connection, 'not-tested'); state.testing(profile); assert.equal(state.forProfile(profile).connection, 'testing'); state.connected(profile); const connected = state.forProfile(profile); assert.equal(connected.connection, 'connected'); assert.ok(connected.lastTest); assert.equal(state.forProfile({ ...profile, id:'other' }).connection, 'not-tested'); state.dispose(); });
