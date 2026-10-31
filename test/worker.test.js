import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {D1Store} from '../worker/d1-store.js';
import {handle,settleHosted} from '../worker/index.js';
import {ESPNProvider} from '../espn.js';
// Real SQLite statements/triggers with the D1 async API. No production fixtures.
class SQLiteD1 {
 constructor(path=':memory:',migrate=true){this.db=new DatabaseSync(path);this.db.exec('PRAGMA foreign_keys=ON');if(migrate)for(const f of ['0000_ledger.sql','0001_atomic.sql','0002_parlays.sql'])this.db.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));}
 prepare(sql){const db=this.db;return {bind(...args){const s=db.prepare(sql);return {async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return {meta:s.run(...args)};}};}};}
 batch(statements){const operation=(this.tail||Promise.resolve()).then(async()=>{this.db.exec('BEGIN IMMEDIATE');try{const out=[];for(const s of statements)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}});this.tail=operation.catch(()=>{});return operation;}
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
test('ESPN uses supported individual UTC dates and safe default fetch binding',async()=>{
 const original=globalThis.fetch,seen=[];let p;
 globalThis.fetch=async function(url){assert.notEqual(this,p,'Worker global fetch must not receive provider as this');seen.push(new URL(url));return new Response('{"events":[]}');};
 try{p=new ESPNProvider();assert.deepEqual(await p.events('americanfootball_nfl'),[]);assert.equal(seen.length,8);assert.ok(seen.every(u=>/^\d{8}$/.test(u.searchParams.get('dates'))));assert.equal(new Set(seen.map(u=>u.searchParams.get('dates'))).size,8);}finally{globalThis.fetch=original;}
 const raw={id:'null-test-only',competitions:[{date:new Date(Date.now()+3600000).toISOString(),status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},competitors:[{id:'1',homeAway:'home',team:{displayName:'Test Home'}},{id:'2',homeAway:'away',team:{displayName:'Test Away'}}],odds:[null]}]};
 assert.equal(new ESPNProvider().normalize(raw,{sport:'Soccer'}),null);
});
const parlayLegs=()=>[1,2].map((n)=>{const e={...event(),id:'test-parlay-'+n,outcomes:[{name:'Fixture Home',price:n===1?2.5:2},{name:'Fixture Away',price:1.5}]};return {event:e,outcome:e.outcomes[0]};});
const legFinal=(n,extra={})=>({...final(),id:'test-parlay-'+n,...extra});
test('parlay debits once, keeps immutable leg prices, waits for all winners and pays once',async()=>{
 const db=new SQLiteD1(),s=new D1Store(db),a=await s.active('parlay'),legs=parlayLegs();
 const ticket=await s.placeParlay('parlay','parlay-request',legs,2000,'',a.id);await s.placeParlay('parlay','parlay-request',legs,2000,'',a.id);
 assert.equal(ticket.odds,5);assert.equal((await s.active('parlay')).balance,98000);assert.equal((await s.all('SELECT * FROM bet_legs')).length,2);
 await s.settle(legFinal(1),'test-only');assert.equal((await s.active('parlay')).balance,98000);assert.equal((await s.snapshot('parlay')).bets[0].status,'open');
 await s.settle(legFinal(2),'test-only');await s.settle(legFinal(2),'test-only');await s.recoverParlays();
 assert.equal((await s.active('parlay')).balance,108000);assert.equal((await s.snapshot('parlay')).bets[0].status,'won');assert.equal((await s.all("SELECT * FROM transactions WHERE kind='settlement'")).length,1);db.db.close();
});
test('parlay loses on any lost leg; void reduction, all void refund and ambiguous result handling',async()=>{
 for(const mode of ['loss','one-void','all-void','ambiguous']){
  const db=new SQLiteD1(),s=new D1Store(db),a=await s.active(mode);await s.placeParlay(mode,'request-'+mode,parlayLegs(),2000,'',a.id);
  const voided={status:'voided',voidConfirmed:true,authoritative:true};
  await s.settle(legFinal(1,mode==='loss'?{scores:[{name:'Fixture Home',score:'1'},{name:'Fixture Away',score:'2'}]}:mode==='ambiguous'?{completed:false,status:'postponed'}:voided),'test');
  await s.settle(legFinal(2,mode==='all-void'?voided:{}),'test');
  const b=(await s.snapshot(mode)).bets[0];assert.equal(b.status,({loss:'lost','one-void':'won','all-void':'void',ambiguous:'unresolved'})[mode]);assert.equal((await s.active(mode)).balance,({loss:98000,'one-void':102000,'all-void':100000,ambiguous:98000})[mode]);db.db.close();
 }
});
test('parlay rejects same-game and overspend, atomically rolls back legs, preserves archived payouts and recovers interruptions',async()=>{
 const db=new SQLiteD1(),s=new D1Store(db),a=await s.active('u'),legs=parlayLegs();
 await assert.rejects(()=>s.placeParlay('u','duplicate-game',[legs[0],legs[0]],2000,'',a.id));
 await assert.rejects(()=>s.placeParlay('u','too-much',legs,100001,'',a.id));assert.equal((await s.all('SELECT * FROM bets')).length,0);assert.equal((await s.all('SELECT * FROM bet_legs')).length,0);
 const b=await s.placeParlay('u','valid',legs,2000,'',a.id);await s.reset('u',50000);
 // Simulate a process interruption after recording final legs but before ticket aggregation.
 await s.q("UPDATE bet_legs SET status='won' WHERE bet_id=?",b.id).run();await s.recoverParlays();await s.recoverParlays();
 assert.equal((await s.active('u')).balance,50000);assert.equal((await s.q('SELECT balance FROM sessions WHERE id=?',a.id).first()).balance,108000);db.db.close();
});
test('HTTP parlay rechecks every leg and requires explicit acceptance; job polls real leg identifiers only',async()=>{
 const db=new SQLiteD1(),env={DB:db,SESSION_SECRET:'test-secret-with-at-least-32-characters'},legs=parlayLegs(),seen=[];
 const p={source:'Test only',verify:async(key,id)=>legs.find(l=>l.event.id===id).event,scores:async(key,ids)=>{seen.push(...ids);return ids.map(id=>({...final(),id}));}};
 const userHeaders={'oai-authenticated-user-id':'parlay-test','content-type':'application/json'},req=(path,body)=>handle(new Request('https://paperbet.test/api/'+path,{headers:userHeaders,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),env,{},p);
 const st=await(await req('state')).json(),body={requestId:'parlay-http-request-0001',sessionId:st.session.id,stake:'20.00',legs:legs.map(l=>({eventId:l.event.id,league:l.event.league,bookmakerKey:l.event.bookmakerKey,selection:l.outcome.name,odds:l.outcome.price}))};body.legs[1].odds=3;
 assert.equal((await req('bets',body)).status,409);assert.equal((await(await req('state')).json()).session.balance,100000);body.legs[1].odds=2;assert.equal((await req('bets',body)).status,201);assert.equal((await req('bets',body)).status,200);
 await new D1Store(db).q('UPDATE bet_legs SET start=?',Date.now()-1000).run();await settleHosted(new D1Store(db),p);
 assert.deepEqual(seen.sort(),['test-parlay-1','test-parlay-2']);const state=await(await req('state')).json();assert.equal(state.session.balance,108000);assert.equal(state.bets[0].legs.length,2);db.db.close();
});
