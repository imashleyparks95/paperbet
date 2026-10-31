import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {D1Store} from '../worker/d1-store.js';
import {handle,settleHosted} from '../worker/index.js';
// Real SQLite statements/triggers with the D1 async API. No production fixtures.
class SQLiteD1 {
 constructor(path=':memory:',migrate=true){this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON');if(migrate)for(const f of ['0000_ledger.sql','0001_atomic.sql'])this.db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}};}
 async batch(statements){this.db.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of statements)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
}
const event=()=>({id:'test-fixture-only',league:'basketball_nba',sport:'Basketball',home:'Fixture Home',away:'Fixture Away',start:Date.now()+3600000,period:'including_overtime',bookmaker:'Test only',bookmakerKey:'test',updated:Date.now(),outcomes:[{name:'Fixture Home',price:2.5},{name:'Fixture Away',price:1.5}]});
const final=()=>({id:'test-fixture-only',sport_key:'basketball_nba',completed:true,authoritative:true,status:'final',period:'including_overtime',scores:[{name:'Fixture Home',score:'101'},{name:'Fixture Away',score:'99'}]});
test('D1 atomic triggers prevent concurrent overspend and duplicate debits; persistence and settlement exactly once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'paperbet-d1-')),path=join(dir,'db');let db=new SQLiteD1(path),s=new D1Store(db);
 try{const session=await s.active('test'),e=event();await Promise.all(Array.from({length:10},()=>s.place('test','same-request',e,e.outcomes[0],2000,'',session.id)));assert.equal((await s.active('test')).balance,98000);assert.equal((await s.snapshot('test')).bets.length,1);
 const rs=await Promise.allSettled(['race-a','race-b'].map(k=>s.place('test',k,e,e.outcomes[0],60000,'',session.id)));assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal((await s.active('test')).balance,38000);
 db.db.close();db=new SQLiteD1(path,false);s=new D1Store(db);assert.equal((await s.active('test')).balance,38000);
 await s.settle(final(),'test-only');await s.settle(final(),'test-only');assert.equal((await s.active('test')).balance,193000);assert.equal((await s.all("SELECT * FROM transactions WHERE kind='settlement'")).length,2);
 await s.reset('test',10000);assert.equal((await s.active('test')).balance,10000);assert.equal((await s.snapshot('test')).sessions.length,2);
 }finally{db.db.close();rmSync(dir,{recursive:true});}
});
test('Worker HTTP: recheck odds, explicit acceptance, dedup, identity, CSRF, failure without debit',async()=>{
 const db=new SQLiteD1(),env={DB:db,SESSION_SECRET:'test-only-secret-at-least-32-characters'},p={source:'Test only',events:async()=>[event()],verify:async()=>event(),scores:async()=>[final()]};
 let cookie;const req=async(path,body,headers={})=>{const r=await handle(new Request('https://paperbet.test/api/'+path,{headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},...(body?{method:'POST',body:JSON.stringify(body)}:{})}),env,{},p);if(r.headers.has('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
 const state=await(await req('state')).json();const body={requestId:'worker-request-0001',sessionId:state.session.id,eventId:event().id,league:event().league,bookmakerKey:'test',selection:'Fixture Home',odds:2,stake:'20.00'};
 assert.equal((await req('bets',body)).status,409);assert.equal((await(await req('state')).json()).session.balance,100000);
 body.odds=2.5;assert.equal((await req('bets',body)).status,201);assert.equal((await req('bets',body)).status,200);assert.equal((await(await req('state')).json()).session.balance,98000);
 assert.equal((await req('bets',{...body,requestId:'another-request-0001'},{origin:'https://evil.test'})).status,403);
 const other=await handle(new Request('https://paperbet.test/api/state',{headers:{'oai-authenticated-user-id':'other'}}),env,{},p);assert.equal((await other.json()).session.balance,100000);
 p.verify=async()=>{throw Error('Feed unavailable');};assert.equal((await req('bets',{...body,requestId:'failure-request-0001'})).status,400);assert.equal((await(await req('state')).json()).session.balance,98000);
 // No browser request participates in this settlement job.
 await new D1Store(db).q('UPDATE bets SET start=?',Date.now()-1000).run();await settleHosted(new D1Store(db),p);await settleHosted(new D1Store(db),p);
 assert.equal((await(await req('state')).json()).session.balance,103000);assert.ok((await(await req('health')).json()).settlement.checkedAt);
 db.db.close();
});
test('D1 batch reset rollback, stale session, archived settlement, ambiguous final and failure health',async()=>{
 const db=new SQLiteD1(),s=new D1Store(db),u=await s.active('x'),e=event();await s.place('x','archive',e,e.outcomes[0],2000,'',u.id);await s.reset('x',50000);
 await assert.rejects(()=>s.place('x','stale',e,e.outcomes[0],100,'',u.id));await s.settle({...final(),completed:false,status:'postponed'},'test');assert.equal((await s.q('SELECT * FROM sessions WHERE id=?',u.id).first()).balance,98000);
 await s.settle(final(),'test');assert.equal((await s.q('SELECT * FROM sessions WHERE id=?',u.id).first()).balance,103000);assert.equal((await s.active('x')).balance,50000);
 const active=await s.active('x');await s.place('x','outage',e,e.outcomes[0],100,'',active.id);await s.q('UPDATE bets SET start=?',Date.now()-1000).run();const h=await settleHosted(s,{scores:async()=>{throw Error('Test outage');}});assert.match(h.error,/Test outage/);assert.equal((await s.active('x')).balance,49900);db.db.close();
});
