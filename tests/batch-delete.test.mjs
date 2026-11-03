import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { AppDatabase } from '../dist/data/database.js';
import { KeyPool } from '../dist/loadbalancer/key-pool.js';
import { LogManager } from '../dist/data/log-manager.js';
import { UsageSyncScheduler } from '../dist/scheduler/usage-sync.js';
import { EventBus } from '../dist/core/event-bus.js';
import { ConnectionStore } from '../dist/core/connection-store.js';
import { ApiRouter } from '../dist/api/router.js';
import { getRuntimeConfig, updateRuntimeConfig } from '../dist/utils/runtime-config.js';

const entry = id => ({ key_id:id,provider:'tavily',tool_name:'search',request_params:'{}',response_data:null,response_status:'success',response_time_ms:1,error_type:null,error_message:null });

test('batch deletion authenticates, validates the whole channel selection, cancels queued sync and retains history', async () => {
  const db=new AppDatabase(':memory:','fake-test-secret'),tavily=new KeyPool(db),exa=new KeyPool(db,'exa'),logs=new LogManager(db);
  const events=new EventBus(),changes=[];events.on('event',event=>{if(event.type==='key_status')changes.push(event)});
  const sync=new UsageSyncScheduler(db,{fetchUsageAndSync(){throw new Error('External API calls are not allowed in this test')}},events);
  const oldPassword=getRuntimeConfig().adminPassword;updateRuntimeConfig({adminPassword:'batch-test-admin'});
  const api=new ApiRouter(db,tavily,sync,events,new ConnectionStore(),exa);
  const server=http.createServer(express().use(express.json()).use('/api',api.router));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const remove=(body,authorized=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/keys/batch/delete`,{method:'POST',headers:{'Content-Type':'application/json',...(authorized?{'X-Admin-Token':'batch-test-admin'}:{})},body:JSON.stringify(body)});
  try{
    for(let n=1;n<=3;n++)tavily.addKey({keyValue:`test-tavily-${n}`});
    for(let n=1;n<=2;n++)exa.addKey({keyValue:`test-exa-${n}`});
    sync.enqueueKeys([1,2,3],'scheduled');
    db.insertRequestLog(entry(1));logs.enqueue(entry(1));logs.enqueue(entry(3));
    db.bindTask('tavily','task_deleted',1);db.bindTask('tavily','task_retained',3);
    db.exaBilling.saveConfig(4,{publicId:'key_test',serviceKey:'fake-service'});
    db.exaBilling.record(4,{operationId:'charge-before-delete',tool:'agent_run',source:'reported',amount:.025,detail:{}});
    assert.equal((await remove({provider:'tavily',ids:[1,2]},false)).status,401);
    for(const payload of [{provider:'tavily',ids:[]},{provider:'tavily',ids:[0]},{provider:'tavily',ids:['1']},{provider:'tavily',ids:[-1]},{provider:'tavily',ids:[Number.MAX_SAFE_INTEGER+1]},{provider:'tavily',ids:Array(1001).fill(1)},{ids:[1]},{provider:'other',ids:[1]},{provider:'tavily',ids:[1,999]},{provider:'tavily',ids:[1,4]}]){
      assert.equal((await remove(payload)).status,400,JSON.stringify(payload).slice(0,100));
      assert.equal(db.getApiKeys().length,5);assert.equal(sync.getStatus().pending,3);
    }
    const response=await remove({provider:'tavily',ids:[1,2,2]});assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{deleted:2,ids:[1,2]});
    assert.deepEqual(tavily.getAllKeys().map(k=>k.id),[3]);assert.equal(exa.getAllKeys().length,2);
    assert.equal(sync.getStatus().pending,1);assert.deepEqual(db.getUsageSyncStates().map(s=>s.key_id),[3]);
    assert.equal(db.getTaskKey('tavily','task_deleted'),null);assert.equal(db.getTaskKey('tavily','task_retained'),3);
    logs.flush();db.insertRequestLog(entry(2));
    const history=db.queryRequestLogs({page:1,limit:20});assert.equal(history.total,4);
    assert.equal(history.logs.filter(l=>l.key_id===null).length,3,'late logs for deleted keys still persist');
    assert.equal(history.logs.filter(l=>l.key_id===3).length,1);
    assert.equal((await remove({provider:'exa',ids:[4,5]})).status,200);
    assert.equal(exa.getActiveKeys().length,0);assert.equal(tavily.getActiveKeys().length,1);
    assert.equal(db.exaBilling.summary().total_usd,.025);assert.equal(db.exaBilling.publicConfig(4).serviceKeyConfigured,false);
    assert.equal(changes.length,2,'one key status notification per successful batch');
  }finally{
    updateRuntimeConfig({adminPassword:oldPassword});sync.stop();logs.shutdown();
    await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections()});db.close();
  }
});

test('a database error during batch deletion rolls back keys and related records together', () => {
  const db=new AppDatabase(':memory:','fake-test-secret');
  try{
    for(let n=1;n<=2;n++)db.addApiKey({keyValue:`rollback-key-${n}`});
    db.insertRequestLog(entry(1));db.markUsageSyncPending(1);
    db.db.exec("CREATE TRIGGER fail_second_delete BEFORE DELETE ON api_keys WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;");
    assert.throws(()=>db.deleteApiKeys([1,2],'tavily'),/simulated storage failure/);
    assert.equal(db.getApiKeys().length,2);assert.equal(db.queryRequestLogs({page:1,limit:20}).logs[0].key_id,1);
    assert.equal(db.getUsageSyncStateForKey(1).last_status,'pending');
  }finally{db.close()}
});
