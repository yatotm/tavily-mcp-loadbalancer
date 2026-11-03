import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import axios from 'axios';
import { AppDatabase } from '../dist/data/database.js';
import { KeyPool } from '../dist/loadbalancer/key-pool.js';
import { ExaKeyTester } from '../dist/providers/exa-key-tester.js';
import { UsageSyncScheduler } from '../dist/scheduler/usage-sync.js';
import { EventBus } from '../dist/core/event-bus.js';
import { ConnectionStore } from '../dist/core/connection-store.js';
import { StatsService } from '../dist/core/stats-service.js';
import { ApiRouter } from '../dist/api/router.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../dist/utils/runtime-config.js';

const fixture = () => {
  const db=new AppDatabase(':memory:','test-secret'),pool=new KeyPool(db,'exa');
  return {db,pool};
};

test('Exa tests pin the selected key, deduplicate concurrent clicks and record one small search fee', async () => {
  const {db,pool}=fixture();
  try{
    const first=pool.addKey({keyValue:'fake-first'}),selected=pool.addKey({keyValue:'fake-selected'});
    let resolve,calls=0;
    const tester=new ExaKeyTester(db,pool,undefined,async(key,params)=>{
      calls++;assert.equal(key,'fake-selected');assert.deepEqual(params,{query:'Exa search engine',type:'lite',numResults:1});
      return new Promise(r=>resolve=r);
    });
    const a=tester.test(selected.id),b=tester.test(selected.id);assert.equal(a,b);assert.equal(calls,1);
    resolve({results:[{text:'Do not store search content'}],costDollars:{total:.003}});
    const result=await a;assert.equal(result.status,'success');assert.equal(result.costUsd,.003);assert.equal(result.costSource,'reported');
    assert.equal(db.exaBilling.summary().operations,1);assert.equal(db.exaBilling.summary(first.id).total_usd,0);
    const logs=db.queryRequestLogs({page:1,limit:10});assert.equal(logs.total,1);assert.equal(logs.logs[0].tool_name,'test');
    assert.ok(!JSON.stringify(logs).includes('Do not store search content'));
    assert.equal(new StatsService(db,new ConnectionStore()).getOverview().requests.total,0);
    assert.equal(db.getApiKeyById(selected.id).total_requests,0,'manual testing does not inflate tool counters');
  }finally{db.close()}
});

test('Exa test failures handle hard and soft errors without retrying another key or enabling stopped keys', async () => {
  for(const [payload,status,expected] of [
    [{tag:'INVALID_API_KEY',error:'Invalid key fake-target'},401,'banned'],
    [{tag:'NO_MORE_CREDITS',error:'No credits'},402,'quota_exceeded'],
    [{tag:'API_KEY_BUDGET_EXCEEDED',error:'budget'},200,'quota_exceeded'],
    [{tag:'FEATURE_DISABLED',error:'feature'},403,'active'],
    [{tag:'RATE_LIMIT_EXCEEDED',error:'rate'},429,'active'],
    [{tag:'SERVICE_OVERLOADED',error:'overload'},503,'active'],
    [{unexpected:true},200,'active'],
  ]){
    const {db,pool}=fixture();
    try{
      const target=pool.addKey({keyValue:'fake-target'}),other=pool.addKey({keyValue:'fake-other'});let calls=0;
      const tester=new ExaKeyTester(db,pool,undefined,async key=>{calls++;assert.equal(key,'fake-target');if(status!==200)throw new axios.AxiosError('failure',undefined,undefined,undefined,{status,data:payload,headers:{'retry-after':'20'}});return payload});
      const result=await tester.test(target.id);assert.equal(result.status,'error');assert.equal(calls,1);assert.equal(db.getApiKeyById(target.id).status,expected);
      assert.equal(db.getApiKeyById(other.id).status,'active');assert.equal(db.exaBilling.summary().operations,0);assert.ok(!JSON.stringify(result).includes('fake-target'));
      assert.ok(!JSON.stringify(db.queryRequestLogs({page:1,limit:20})).includes('fake-target'));
      if(status===429)assert.ok(!pool.getActiveKeys().some(k=>k.id===target.id));
    }finally{db.close()}
  }
  for(const initial of ['banned','disabled','quota_exceeded']){
    const {db,pool}=fixture();
    try{
      const key=pool.addKey({keyValue:'fake-manual'});pool.updateStatus(key.id,initial);
      const result=await new ExaKeyTester(db,pool,undefined,async()=>({results:[]})).test(key.id);
      assert.equal(result.status,'success');assert.equal(result.costUsd,.004);assert.equal(result.costSource,'estimated');
      assert.equal(db.getApiKeyById(key.id).status,initial==='quota_exceeded'?'active':initial);
    }finally{db.close()}
  }
});

test('single-key test API authenticates, queues Tavily checks, exposes progress and dispatches Exa by ID', async () => {
  const {db,pool:exa}=fixture(),tavily=new KeyPool(db),events=new EventBus();
  const tv=tavily.addKey({keyValue:'fake-tavily'}),ex=exa.addKey({keyValue:'fake-exa'});
  const sync=new UsageSyncScheduler(db,{fetchUsageAndSync(){throw new Error('No upstream calls')}},events);
  let seen;
  const tester={test:async id=>{seen=id;return {status:'success',message:'ok',costUsd:.004,costSource:'estimated',durationMs:1}}};
  const api=new ApiRouter(db,tavily,sync,events,new ConnectionStore(),exa,undefined,undefined,undefined,undefined,tester);
  const before=getRuntimeConfig().adminPassword;updateRuntimeConfig({adminPassword:'test-admin'});
  const server=http.createServer(express().use(express.json()).use('/api',api.router));server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/keys`;
  const post=(id,auth=true)=>fetch(`${base}/${id}/test`,{method:'POST',headers:auth?{'X-Admin-Token':'test-admin'}:{}});
  try{
    assert.equal((await post(tv.id,false)).status,401);assert.equal(sync.getStatus().pending,0);
    assert.equal((await post(999)).status,404);assert.equal((await post(-1)).status,400);
    const queued=await post(tv.id);assert.equal(queued.status,202);assert.equal((await queued.json()).status,'queued');assert.equal(sync.getStatus().pending,1);
    await post(tv.id);assert.equal(sync.getStatus().pending,1);
    const progress=await fetch(`${base}/${tv.id}`,{headers:{'X-Admin-Token':'test-admin'}}).then(r=>r.json());assert.equal(progress.usage_sync.last_status,'pending');assert.ok(!progress.key_value);
    assert.equal((await (await post(ex.id)).json()).status,'success');assert.equal(seen,ex.id);assert.equal(sync.getStatus().pending,1);
  }finally{sync.stop();updateRuntimeConfig({adminPassword:before});await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()});db.close()}
});
