import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { AppDatabase } from '../dist/data/database.js';
import { KeyPool } from '../dist/loadbalancer/key-pool.js';
import { LogManager } from '../dist/data/log-manager.js';
import { classifyError, classifyMcpResult, classifyResponsePayload } from '../dist/loadbalancer/error-classifier.js';
import { RequestExecutor, RequestGate, UpstreamFailure } from '../dist/client/request-executor.js';
import { nextReset } from '../dist/loadbalancer/quota-policy.js';
import { QuotaRefresher } from '../dist/scheduler/quota-refresh.js';
import { exaCharge } from '../dist/billing/exa-cost.js';
import { ExaUsageClient } from '../dist/billing/exa-usage.js';
import { UsageClient } from '../dist/client/usage-client.js';
import { StatsService } from '../dist/core/stats-service.js';
import { ConnectionStore } from '../dist/core/connection-store.js';

const fixture = () => {
  const db = new AppDatabase(':memory:', 'test-encryption');
  const tavily = new KeyPool(db), exa = new KeyPool(db, 'exa'), logs = new LogManager(db);
  return { db, tavily, exa, logs, close() { logs.shutdown(); db.close(); } };
};
const mcp = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failure = (tag, status) => classifyError(new Error('upstream'), { tag, error: tag }, status, undefined, 'exa');

test('Exa status, soft errors and content-level failures have different key lifecycle effects', () => {
  for (const [status, tag, type] of [
    [401,'INVALID_API_KEY','auth'], [402,'NO_MORE_CREDITS','quota_exceeded'],
    [402,'API_KEY_BUDGET_EXCEEDED','quota_exceeded'], [402,'TEAM_BUDGET_EXCEEDED','quota_exceeded'],
    [403,'TEAM_BLOCKED','auth'], [403,'FEATURE_DISABLED','client'], [403,'PROHIBITED_CONTENT','client'],
    [403,'CONTENT_FILTER_ERROR','client'], [429,'RATE_LIMIT_EXCEEDED','rate_limit'],
    [429,'CONCURRENCY_LIMIT_REACHED','rate_limit'], [503,'SERVICE_OVERLOADED','server'],
    [422,'UNKNOWN_NEW_TAG','client'], [503,'UNKNOWN_NEW_TAG','server'],
  ]) {
    assert.equal(failure(tag, status).type, type, tag);
    if (tag !== 'UNKNOWN_NEW_TAG') assert.equal(classifyMcpResult(mcp({ error: tag, tag }), 'exa').type, type, `${tag} HTTP 200`);
  }
  assert.equal(failure('INVALID_API_KEY', 500).type, 'server', 'HTTP status takes precedence over tag');
  assert.equal(classifyError(null, { error: 'limit' }, 429, '17', 'exa').retryDelay, 17000);
  assert.equal(classifyMcpResult({ isError: false, content: [{type:'text',text:'web_search_exa error (402): NO_MORE_CREDITS'}] }, 'exa').type, 'quota_exceeded');
  assert.equal(classifyMcpResult({ isError: true, content: [{type:'text',text:'agent_run error (403): FEATURE_DISABLED'}] }, 'exa').shouldDisableKey, false);
  assert.equal(classifyResponsePayload({ results: [{ error: 'INVALID_API_KEY', text: 'quota exceeded' }], statuses: [{ status: 'error', error: { tag: 'INVALID_API_KEY' } }] }, 'exa'), null);
  assert.equal(classifyMcpResult(mcp({ results: [{ text: 'web_search_exa error (401): Invalid API key' }] }), 'exa'), null);
  for (const status of [432,433]) assert.equal(classifyError(null, {}, status).type, 'quota_exceeded');
});

test('quota/auth failover is persistent; permission errors do not ban; non-idempotent jobs retry only confirmed unprocessed errors', async () => {
  const f = fixture();
  try {
    const first=f.exa.addKey({keyValue:'fake-exa-1'}), second=f.exa.addKey({keyValue:'fake-exa-2'});
    const executor = new RequestExecutor(f.db, f.exa, f.logs, new RequestGate());
    executor.retryConfig = { maxRetries: 2, baseDelay: 1, maxDelay: 2, exponentialBase: 2, jitter: false };
    const seen=[];
    assert.equal(await executor.run('web_search_exa',{},async key=>{seen.push(key.id);if(key.id===first.id)throw new UpstreamFailure(failure('NO_MORE_CREDITS'));return 'ok';}),'ok');
    assert.deepEqual(seen,[first.id,second.id]);
    f.exa.reload();
    assert.equal(f.db.getApiKeyById(first.id).status,'quota_exceeded');
    assert.match(f.db.getApiKeyById(first.id).quota_reset_at,/^\d{4}-\d{2}-01T00:00/);
    assert.equal(f.db.getApiKeyById(first.id).error_count,0);
    const refresher=new QuotaRefresher(f.db,f.tavily,f.exa);refresher.refresh();
    assert.equal(f.db.getApiKeyById(first.id).status,'quota_exceeded');
    await assert.rejects(executor.run('agent_run',{},async()=>{throw new UpstreamFailure(failure('FEATURE_DISABLED'));},{retrySafe:false}));
    assert.equal(f.db.getApiKeyById(second.id).status,'active');
    let attempts=0;
    assert.equal(await executor.run('agent_run',{},async()=>{if(++attempts===1)throw new UpstreamFailure(failure('SERVICE_OVERLOADED'));return 'created';},{retrySafe:false}),'created');
    assert.equal(attempts,2);
    await assert.rejects(executor.run('search',{},async()=>{throw new UpstreamFailure(failure('INVALID_API_KEY'));}));
    f.db.setQuotaPause(second.id,'NO_MORE_CREDITS','2000-01-01T00:00:00.000Z');
    f.db.setQuotaPause(first.id,'NO_MORE_CREDITS','2000-01-01T00:00:00.000Z');refresher.refresh();
    assert.equal(f.db.getApiKeyById(first.id).status,'active');
    assert.equal(f.db.getApiKeyById(second.id).status,'banned');
  } finally { f.close(); }
});

test('reset schedules separate Tavily calendar months, Exa free balance, configured budget cycles and permanent stops', () => {
  const now=new Date('2026-11-03T06:00:00Z');
  assert.equal(nextReset('tavily','anything',undefined,now),'2026-12-01T00:00:00.000Z');
  assert.equal(nextReset('exa','NO_MORE_CREDITS',{resetMode:'auto'},now),'2026-12-01T00:00:00.000Z');
  assert.equal(nextReset('exa','API_KEY_BUDGET_EXCEEDED',{resetMode:'auto'},now),null);
  assert.equal(nextReset('exa','TEAM_BUDGET_EXCEEDED',{resetMode:'monthly',resetDay:15},now),'2026-11-15T00:00:00.000Z');
  assert.equal(nextReset('exa','NO_MORE_CREDITS',{resetMode:'manual'},now),null);
});

test('Exa pricing uses official MCP request defaults, mode, result count and content types; reported dollars win', () => {
  const ok=mcp({results:[]});
  for(const [tool,args,amount] of [
    ['web_search_exa',{},.007],['web_search_advanced_exa',{type:'instant'},.004],
    ['web_search_advanced_exa',{type:'auto',numResults:20,enableSummary:true},.037],
    ['web_search_advanced_exa',{type:'deep',numResults:5,enableSummary:true,subpages:2},.027],
    ['deep_search_exa',{},.012],['deep_search_exa',{type:'deep-reasoning'},.015],
    ['get_code_context_exa',{},.004],['company_research_exa',{},.007],
    ['people_search_exa',{},.007],['linkedin_search_exa',{},.007],
    ['web_fetch_exa',{urls:['https://example.com','https://example.net']},.002],
    ['crawling_exa',{urls:['https://example.com']},.001],
  ]) assert.equal(exaCharge(tool,args,ok,1).amount,amount,`${tool} ${JSON.stringify(args)}`);
  assert.equal(exaCharge('web_search_exa',{},mcp({costDollars:{total:.0017},results:[]}),1).source,'reported');
  assert.equal(exaCharge('web_search_exa',{},mcp({results:[{costDollars:100}]}),1).amount,.007);
  assert.equal(exaCharge('web_search_exa',{},ok,1,true),null);
  assert.equal(exaCharge('agent_run',{effort:'auto',maxCostDollars:20},mcp({id:'job1',status:'completed'}),1).amount,null);
  assert.equal(exaCharge('agent_run',{effort:'low'},mcp({id:'job2',status:'completed'}),1).amount,.025);
  assert.equal(exaCharge('agent_run',{effort:'low'},mcp({id:'job3',status:'running'}),1).source,'pending');
});

test('paid task polls reconcile one charge, survive log cleanup and keep masked credentials out of public config', () => {
  const f=fixture();
  try {
    const key=f.exa.addKey({keyValue:'fake-exa-ledger'});
    const record=result=>f.db.exaBilling.record(key.id,exaCharge('agent_run',{runId:'job1'},mcp(result),key.id));
    record({id:'job1',status:'running'});
    assert.equal(record({id:'job1',status:'completed',costDollars:.027}).cost_usd,.027);
    assert.equal(record({id:'job1',status:'completed',costDollars:.027}).cost_usd,0);
    assert.equal(record({id:'job1',status:'completed',costDollars:.03}).cost_usd,.003);
    record({id:'job1',status:'running'});
    assert.equal(f.db.exaBilling.summary(key.id).operations,1);
    assert.equal(f.db.exaBilling.summary(key.id).total_usd,.03);
    f.db.insertRequestLogs([{provider:'exa',key_id:key.id,tool_name:'agent_run',request_params:null,response_data:null,response_status:'success',response_time_ms:1,error_type:null,error_message:null,cost_usd:.03,cost_source:'reported'}]);
    assert.equal(f.db.queryRequestLogs({page:1,limit:20}).logs[0].cost_usd,.03);
    f.db.exaBilling.saveConfig(key.id,{publicId:'key_example',serviceKey:'fake-service-secret'});
    f.db.exaBilling.setSnapshot(key.id,{usedUsd:1});
    f.db.exaBilling.saveConfig(key.id,{resetMode:'manual',serviceKey:''});
    assert.equal(f.db.exaBilling.snapshot(key.id).usedUsd,1,'unmodified credentials retain usage snapshot');
    assert.equal(f.db.exaBilling.getConfig(key.id).serviceKey,'fake-service-secret');
    assert.ok(!JSON.stringify(f.db.exaBilling.publicConfig(key.id)).includes('fake-service-secret'));
    assert.throws(()=>f.db.exaBilling.saveConfig(key.id,{publicId:'actual-secret'}));
    f.exa.deleteKey(key.id);
    assert.equal(f.db.exaBilling.summary().total_usd,.03,'deleting a key retains the account cost ledger');
  }finally{f.close();}
});

test('official usage sync uses Service Key, strips legacy secret fields and never disables a search key for management auth failures', async () => {
  const f=fixture();let status=200,overBudget=true,calls=0;
  const server=http.createServer((req,res)=>{
    calls++;assert.equal(req.headers['x-api-key'],'fake-service');assert.ok(!req.url.includes('fake-search'));
    res.setHeader('Content-Type','application/json');res.statusCode=status;
    const url=new URL(req.url,'http://localhost');
    if(status!==200)return res.end(JSON.stringify({error:'invalid service key'}));
    if(url.pathname.endsWith('/usage')){
      assert.match(url.searchParams.get('start_date'),/T00:00:00.000Z$/);
      res.end(JSON.stringify({id:'key_demo',api_key_id:'never-persist-this-secret',total_cost_usd:1.23}));
    }else res.end(JSON.stringify({apiKey:{publicId:'key_demo',secret:'never-persist-this-secret',budgetCents:500,isOverBudget:overBudget}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=new ExaUsageClient(f.db,f.exa,undefined,`http://127.0.0.1:${server.address().port}`);
  try{
    const key=f.exa.addKey({keyValue:'fake-search'});
    await assert.rejects(client.sync(key.id),/Service Key/);assert.equal(calls,0);
    f.db.exaBilling.saveConfig(key.id,{publicId:'key_demo',serviceKey:'fake-service'});
    const [result]=await Promise.all([client.sync(key.id),client.sync(key.id)]);
    assert.equal(calls,2);assert.equal(result.usedUsd,1.23);assert.equal(result.budgetUsd,5);
    assert.ok(!JSON.stringify(f.db.exaBilling.summary(key.id)).includes('never-persist'));
    assert.equal(f.db.getApiKeyById(key.id).status,'quota_exceeded');
    assert.equal(f.db.getApiKeyById(key.id).quota_reset_at,null);
    status=401;await assert.rejects(client.sync(key.id),/Service Key/);assert.equal(f.db.getApiKeyById(key.id).status,'quota_exceeded');
    status=200;overBudget=false;await client.sync(key.id);assert.equal(f.db.getApiKeyById(key.id).status,'active');
    f.exa.pauseQuota(key.id,'NO_MORE_CREDITS');await client.sync(key.id);assert.equal(f.db.getApiKeyById(key.id).status,'quota_exceeded');
    f.exa.updateStatus(key.id,'banned');await client.sync(key.id);assert.equal(f.db.getApiKeyById(key.id).status,'banned');
    assert.equal(f.db.exaBilling.summary().total_usd,0,'official snapshot is not added to local charges');
  }finally{client.stop();await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});f.close();}
});

test('database pagination filters before counting, clamps deleted pages and escapes literal wildcards', () => {
  const f=fixture();
  try{
    for(let n=1;n<=25;n++) f.tavily.addKey({keyValue:`fake-tavily-${n}`,displayName:n===2?'literal 10%_quota':`key ${n}`});
    f.exa.addKey({keyValue:'fake-exa'});f.tavily.updateStatus(1,'disabled');
    const q=overrides=>f.db.queryApiKeys({provider:'tavily',page:1,limit:10,...overrides});
    assert.equal(q({}).total,25);assert.equal(q({page:2}).keys[0].id,11);
    assert.equal(q({page:99}).page,3);assert.equal(q({page:99}).keys.length,5);
    assert.equal(q({status:'active'}).total,24);
    assert.equal(q({keyword:'%_'}).keys[0].id,2);assert.equal(q({keyword:'%_'}).total,1);
    assert.equal(q({keyword:'absent'}).page,1);
    for(let n=21;n<=25;n++)f.tavily.deleteKey(n);
    assert.equal(q({page:3}).page,2);
    assert.ok(q({}).keys.every(k=>k.provider==='tavily'));
  }finally{f.close();}
});

test('Tavily dashboard restores used, known total, remaining and usable quota without mixing Exa dollars', async () => {
  const f=fixture();
  try{
    for(let n=1;n<=3;n++)f.tavily.addKey({keyValue:`fake-${n}`});f.exa.addKey({keyValue:'fake-exa'});
    const period=new Date().toISOString().slice(0,7);
    f.db.updateMonthlyQuotaFromUsage({keyId:1,yearMonth:period,usedCount:100,quotaLimit:1000,resetAt:null});
    f.db.updateMonthlyQuotaFromUsage({keyId:2,yearMonth:period,usedCount:200,quotaLimit:1000,resetAt:null});
    f.tavily.updateStatus(2,'banned');
    const quota=new StatsService(f.db,new ConnectionStore()).getOverview().quota;
    assert.equal(quota.used,300);assert.equal(quota.known_limit,2000);assert.equal(quota.known_remaining,1700);assert.equal(quota.available,900);assert.equal(quota.unknown_keys,1);
    const usage=new UsageClient(f.db);
    usage.fetchUsage=async()=>({key:{usage:1000,limit:1000},account:{plan_usage:1000,plan_limit:1000,paygo_usage:0,paygo_limit:0}});
    await usage.fetchUsageAndSync(1,'fake-1');assert.equal(f.db.getApiKeyById(1).status,'quota_exceeded');
    usage.fetchUsage=async()=>({key:{usage:0,limit:1000},account:{plan_usage:0,plan_limit:1000,paygo_usage:0,paygo_limit:0}});
    await usage.fetchUsageAndSync(1,'fake-1');assert.equal(f.db.getApiKeyById(1).status,'active');
    await usage.fetchUsageAndSync(2,'fake-2');assert.equal(f.db.getApiKeyById(2).status,'banned');
  }finally{f.close();}
});
