import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import axios from 'axios';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { AppDatabase } from '../dist/data/database.js';
import { KeyPool } from '../dist/loadbalancer/key-pool.js';
import { LogManager } from '../dist/data/log-manager.js';
import { RequestExecutor, RequestGate } from '../dist/client/request-executor.js';
import { DecisionSettings, decisionEndpoint } from '../dist/moderation/config.js';
import { ResultReviewer, ReviewUnavailable } from '../dist/moderation/reviewer.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../dist/utils/runtime-config.js';
import { ToolRouter } from '../dist/core/tools/tool-router.js';
import { HttpServer } from '../dist/core/http-server.js';
import { EventBus } from '../dist/core/event-bus.js';
import { ConnectionStore } from '../dist/core/connection-store.js';
import { ApiRouter } from '../dist/api/router.js';
import { classifyError } from '../dist/loadbalancer/error-classifier.js';
import { StatsService } from '../dist/core/stats-service.js';

const fixture = () => {
  const db = new AppDatabase(':memory:', 'test-secret');
  const pool = new KeyPool(db), exa = new KeyPool(db, 'exa'), logs = new LogManager(db);
  return { db, pool, exa, logs, close: () => { logs.shutdown(); db.close(); } };
};
const listen = async handler => { const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening'); return { server, url: `http://127.0.0.1:${server.address().port}` }; };
const closeServer = server => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });

// Real local System One HTTP contract, no external requests or API credits.
async function reviewFixture(mode = 'soft', updates = {}) {
  const f = fixture(); let calls = 0, maxActive = 0, active = 0;
  const { server, url } = await listen(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); calls++; active++; maxActive = Math.max(maxActive, active);
    assert.equal(req.url, '/compatible-mode/v1/systemone');
    assert.equal(body.model, 'decision-model-preview');
    assert.ok(Object.keys(body.questions).length <= 16);
    assert.ok(body.state.items.every(i => body.questions[i.id].type === 'noul'));
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'auth') { res.statusCode = 401; res.end(JSON.stringify({ error: { code: 'InvalidApiKey' } })); }
    else if (mode === 'malformed') res.end('{"answers":{}}');
    else if (mode === 'hard' && body.state.items.some(i => i.content.includes('UNSAFE_MARKER'))) { res.statusCode = 400; res.end(JSON.stringify({ code: 'DataInspectionFailed', message: 'inappropriate content' })); }
    else res.end(JSON.stringify({ answers: Object.fromEntries(body.state.items.map(i => [i.id, { type: 'noul', noul: i.content.includes('UNSAFE_MARKER') ? 0.99 : 0.01 }])) }));
    active--;
  });
  const settings = new DecisionSettings(f.db);
  settings.save({ enabled: true, channels: { tavily: true, exa: true }, baseUrl: `${url}/compatible-mode/v1`, apiKey: 'not-a-real-key', ...updates });
  return { ...f, settings, reviewer: new ResultReviewer(settings, f.logs), calls: () => calls, maxActive: () => maxActive,
    close: async () => { await closeServer(server); f.close(); } };
}

test('provider pools isolate keys, weighted round robin is fair, secrets remain encrypted', () => {
  const f = fixture();
  try {
    f.pool.addKey({ keyValue: 'test-tavily-one', weight: 2 }); f.pool.addKey({ keyValue: 'test-tavily-two' }); f.exa.addKey({ keyValue: 'test-exa-one' });
    const ids = Array.from({ length: 6 }, () => f.pool.getNextKey().id);
    assert.equal(ids.filter(id => id === 1).length, 4); assert.equal(ids.filter(id => id === 2).length, 2);
    assert.equal(f.exa.getNextKey().provider, 'exa'); assert.equal(f.pool.getAllKeys().length, 2);
    assert.throws(() => f.exa.addKey({ keyValue: 'test-other', weight: 0 }));
    const settings = new DecisionSettings(f.db); settings.save({ apiKey: 'super-secret' });
    assert.ok(!f.db.getConfigValue('decisionApiKey').includes('super-secret'));
    assert.equal(settings.public().apiKey, undefined); settings.save({ apiKey: '' }); assert.equal(settings.get().apiKey, 'super-secret');
    assert.equal(new DecisionSettings(f.db).get().apiKey, 'super-secret');
  } finally { f.close(); }
});

test('auth failure selects another key; rate limits do not ban; paid jobs are not retried on network failure', async () => {
  const f = fixture();
  try {
    f.pool.addKey({ keyValue: 'bad-key' }); f.pool.addKey({ keyValue: 'good-key' });
    const executor = new RequestExecutor(f.db, f.pool, f.logs, new RequestGate());
    const seen = [];
    const result = await executor.run('search', {}, async k => { seen.push(k.id); if (k.id === 1) throw new axios.AxiosError('invalid key', undefined, undefined, undefined, { status: 401, data: {} }); return 'ok'; });
    assert.equal(result, 'ok'); assert.deepEqual(seen, [1, 2]); assert.equal(f.db.getApiKeyById(1).status, 'banned');
    assert.equal(classifyError(new axios.AxiosError('rate limit exceeded'), { message: 'rate limit exceeded' }, 429).type, 'rate_limit');
    assert.equal(classifyError(new axios.AxiosError('credit depleted'), {}, 402).type, 'quota_exceeded');
    let attempts = 0;
    await assert.rejects(executor.run('agent_run', {}, async () => { attempts++; throw new axios.AxiosError('timeout', 'ETIMEDOUT'); }, { retrySafe: false }));
    assert.equal(attempts, 1);
    f.db.bindTask('exa', 'run-1234', 2); assert.equal(f.db.getTaskKey('exa', 'run-1234'), 2);
  } finally { f.close(); }
});

test('review removes only unsafe results and duplicate representations; metadata and images cannot bypass it', async () => {
  const f = await reviewFixture();
  try {
    const payload = { results: [{ title: 'safe', text: 'weather' }, { title: 'bad', text: 'UNSAFE_MARKER' }], answer: 'UNSAFE_MARKER summary', images: [{ description: 'UNSAFE_MARKER', url: 'https://example.com' }] };
    const input = { content: [{ type: 'text', text: JSON.stringify(payload), _meta: { hidden: 'UNSAFE_MARKER' }, unrecognized: 'UNSAFE_MARKER' }, { type: 'image', data: 'opaque', mimeType: 'image/png' }], structuredContent: payload, _meta: { unsafe: 'UNSAFE_MARKER' } };
    const result = await f.reviewer.review('tavily', input);
    assert.ok(!JSON.stringify(result).includes('UNSAFE_MARKER'));
    assert.equal(JSON.parse(result.content[0].text).results.length, 1);
    assert.equal(result.structuredContent.results.length, 1);
    assert.equal(result.content.length, 1); assert.ok(result._meta.gateway_review.removed >= 3);
    assert.ok(JSON.stringify(input).includes('UNSAFE_MARKER'), 'input must not be mutated');
  } finally { await f.close(); }
});

test('provider hard refusal triggers bisection, preserves safe siblings, and bounds calls', async () => {
  const f = await reviewFixture('hard');
  try {
    const result = await f.reviewer.review('exa', { results: [{ text: 'safe1' }, { text: 'safe2' }, { text: 'UNSAFE_MARKER' }, { text: 'safe3' }] });
    assert.deepEqual(result.results.map(r => r.text), ['safe1', 'safe2', 'safe3']);
    assert.equal(f.calls(), 5); assert.ok(f.maxActive() <= 2);
  } finally { await f.close(); }
});

test('auth and malformed reviewer responses fail closed without poison bisection', async () => {
  for (const mode of ['auth', 'malformed']) {
    const f = await reviewFixture(mode);
    try { await assert.rejects(f.reviewer.review('exa', { results: ['a', 'b'] }), ReviewUnavailable); assert.equal(f.calls(), 1); }
    finally { await f.close(); }
  }
});

test('review inspects beyond long-content prefixes; budget exhaustion never forwards unreviewed text', async () => {
  const f = await reviewFixture('soft', { maxBatchChars: 1000 });
  try {
    const result = await f.reviewer.review('exa', { results: [{ text: 'x'.repeat(1800) + 'UNSAFE_MARKER' }, { text: 'safe' }] });
    assert.deepEqual(result.results, [{ text: 'safe' }]); assert.ok(f.calls() >= 2);
    f.settings.save({ maxCalls: 1 });
    await assert.rejects(f.reviewer.review('exa', { results: ['a'.repeat(2500)] }), ReviewUnavailable);
    f.settings.save({ channels: { exa: false } }); const input = { results: ['UNSAFE_MARKER'] }; assert.equal(await f.reviewer.review('exa', input), input);
  } finally { await f.close(); }
});

test('decision endpoints normalize supported forms and reject credential-bearing URLs', () => {
  for (const suffix of ['', '/v1', '/v1/', '/v1/systemone']) assert.equal(decisionEndpoint(`https://example.com/compatible-mode${suffix}`), 'https://example.com/compatible-mode/v1/systemone');
  assert.throws(() => decisionEndpoint('https://name:password@example.com')); assert.throws(() => decisionEndpoint('https://example.com?api_key=secret'));
});

test('official tool schemas, legacy names, complete false/zero fields and local validation', async () => {
  let received;
  const tavily = { search: async args => { received = args; return { results: [] }; } };
  const remote = { call: async (name, args) => { received = args; return { content: [{ type: 'text', text: 'ok' }] }; } };
  const router = new ToolRouter(tavily, remote, remote);
  assert.equal(router.listTools('exa').length, 12);
  assert.ok(router.listTools().some(t => t.name === 'tavily_research'));
  await router.callTool('tavily-search', { query: 'hello', max_results: 0, include_answer: false, exact_match: true });
  assert.equal(received.max_results, 0); assert.equal(received.include_answer, false); assert.equal(received.exact_match, true);
  await router.callTool('web_search_advanced_exa', { query: 'hi', moderation: false, maxAgeHours: 0, includeDomains: [] }, 'exa');
  assert.equal(received.maxAgeHours, 0); assert.equal(received.moderation, false);
  await assert.rejects(router.callTool('tavily_search', {}, 'tavily'), /Invalid tool arguments/);
  await assert.rejects(router.callTool('web_search_exa', {}, 'tavily'), /Unknown/);
});

test('HTTP and SSE clients work across all paths; stale sessions cannot run tools; settings validate', async () => {
  const f = fixture(); const events = new EventBus(), store = new ConnectionStore();
  let dispatched = 0;
  const router = { listTools: provider => [{ name: `${provider}_test`, inputSchema: { type: 'object' } }], callTool: async (name, args, provider) => { dispatched++; return { content: [{ type: 'text', text: `${provider}\n"quoted" \\ path` }] }; } };
  const api = new ApiRouter(f.db, f.pool, { getStatus: () => ({}) }, events, store, f.exa);
  const gateway = new HttpServer(router, api, events, store);
  const { server, url } = await listen(gateway.app);
  const originalPassword = getRuntimeConfig().adminPassword;
  updateRuntimeConfig({ adminPassword: 'test-admin' });
  try {
    for (const [prefix, provider] of [['', 'tavily'], ['/tavily', 'tavily'], ['/exa', 'exa']]) {
      for (const protocol of ['mcp', 'sse']) {
        const c = new Client({ name: 'test', version: '1' });
        try {
          await c.connect(protocol === 'mcp' ? new StreamableHTTPClientTransport(new URL(`${url}${prefix}/mcp`)) : new SSEClientTransport(new URL(`${url}${prefix}/sse`)));
          assert.equal((await c.listTools()).tools[0].name, `${provider}_test`);
          const result = await c.callTool({ name: `${provider}_test`, arguments: {} });
          assert.equal(result.content[0].text, `${provider}\n"quoted" \\ path`);
          await c.ping();
        } finally { await c.close(); }
      }
    }
    const before = dispatched;
    const badSession = await fetch(`${url}/message?sessionId=missing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search' } }) });
    assert.equal(badSession.status, 404); assert.equal(dispatched, before);
    const auth = await fetch(`${url}/api/settings`); assert.equal(auth.status, 401);
    const invalid = await fetch(`${url}/api/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'test-admin' }, body: JSON.stringify({ maxConcurrentRequests: 0 }) });
    assert.equal(invalid.status, 400);
    const notice = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(notice.status, 202);
  } finally { updateRuntimeConfig({ adminPassword: originalPassword }); await gateway.stop(); await closeServer(server); f.close(); }
});

test('log summaries omit large payloads and maintenance does not alter tool success rate', () => {
  const f = fixture();
  try {
    for (const tool of ['search', 'sync_quota', 'moderation']) f.db.insertRequestLog({ key_id: null, provider: 'tavily', tool_name: tool, request_params: 'large', response_data: 'x'.repeat(10000), response_status: tool === 'search' ? 'success' : 'error', response_time_ms: 100, error_type: null, error_message: null });
    const stats = new StatsService(f.db, new ConnectionStore()).getOverview();
    assert.equal(stats.requests.total, 1); assert.equal(stats.requests.success_rate, 100);
    assert.equal(f.db.queryRequestLogs({ page: -1, limit: -3, includePayload: false }).logs[0].response_data, undefined);
  } finally { f.close(); }
});

test('review also checks arbitrary nested property names in structured output', async () => {
  const f = await reviewFixture();
  try {
    const output = await f.reviewer.review('exa', { content: [{ type: 'text', text: JSON.stringify({ UNSAFE_MARKER: 1, strange: { UNSAFE_MARKER: true }, results: [{ text: 'safe' }] }) }], structuredContent: { UNSAFE_MARKER: true, output: { structured: { UNSAFE_MARKER: 'benign value' } }, id: 'agent_run_example' } });
    assert.ok(!JSON.stringify(output).includes('UNSAFE_MARKER'));
    assert.ok(JSON.stringify(output).includes('safe'));
  } finally { await f.close(); }
});
