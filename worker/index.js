import {ESPNProvider} from '../espn.js';
import {stakeCents,leagues} from '../domain.js';
import {D1Store} from './d1-store.js';
const ASSETS = {}; // Build embeds the existing public/ files here.
const provider=new ESPNProvider();
const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{...security,'Content-Type':'application/json','Cache-Control':'no-store',...extra}});
export async function settleHosted(store,p=provider){
 const now=Date.now();const lease=await store.q("INSERT INTO jobs VALUES('settlement',?) ON CONFLICT(key) DO UPDATE SET lease_until=excluded.lease_until WHERE lease_until<? RETURNING key",now+120000,now).first();
 if(!lease)return {busy:true};
 let checked=0,errors=[];
 try{
  const pending=await store.all("SELECT event_id,league,MIN(checked_at) AS last_checked FROM bets WHERE status IN ('open','live','unresolved') AND start<=? AND checked_at<? GROUP BY event_id,league ORDER BY last_checked LIMIT 20",now,now-240000);
  for(let i=0;i<pending.length;i+=4)await Promise.all(pending.slice(i,i+4).map(async b=>{try{for(const r of await p.scores(b.league,[b.event_id]))await store.settle(r,p.source);checked++;}catch(e){errors.push(b.league+': '+e.message);}finally{await store.q('UPDATE bets SET checked_at=? WHERE event_id=? AND league=?',Date.now(),b.event_id,b.league).run();}}));
  const remaining=await store.q("SELECT COUNT(DISTINCT event_id) AS n FROM bets WHERE status IN ('open','live','unresolved') AND start<=? AND checked_at<?",Date.now(),Date.now()-240000).first();
  const health={checkedAt:Date.now(),checked,remaining:remaining.n,error:errors.length?errors.join('; '):null,cadence:'Cloud task every 30 minutes; retries on next run; no browser required'};
  await store.q('INSERT INTO health VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value','settlement',JSON.stringify(health)).run();return health;
 }finally{await store.q("UPDATE jobs SET lease_until=0 WHERE key='settlement'").run();}
}
async function identity(request,secret){
 // Sites sign-in is the persistent identity for normal visitors, including installed PWAs.
 const signedIn=request.headers.get('oai-authenticated-user-id');if(signedIn)return {user:'chatgpt:'+signedIn};
 // Preserve signed browser sessions for authorized service verification without a visitor identity.
 if(!secret||secret.length<32)throw Error('Session secret is not configured');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 const cookie=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(c=>c.startsWith('paperbet='))?.slice(9);const [id,sig]=cookie?.split('.')||[];
 if(/^[a-f0-9]{64}$/.test(id||'')&&/^[a-f0-9]{64}$/.test(sig||'')){const bytes=Uint8Array.from(sig.match(/../g),v=>parseInt(v,16));if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(id)))return {user:id};}
 const user=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');const mac=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(user))),n=>n.toString(16).padStart(2,'0')).join('');
 return {user,cookie:`paperbet=${user}.${mac}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`};
}
export async function handle(request,env,ctx={},p=provider){
 const url=new URL(request.url);
 try{
  if(url.pathname==='/mcp'&&request.method==='POST'){
   const rpc=await request.json();let result;
   if(rpc.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}}};
   else if(rpc.method==='tools/list')result={tools:[{name:'settle_paperbet',description:'Fetch genuine ESPN results and settle eligible virtual-money bets once. Never accepts odds or result overrides. Call without a browser.',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'paperbet_health',description:'Read the last persisted PaperBet background settlement check.',inputSchema:{type:'object',properties:{},additionalProperties:false}}]};
   else if(rpc.method==='tools/call'){
    const store=new D1Store(env.DB);let data;
    if(rpc.params?.name==='settle_paperbet')data=await settleHosted(store,p);
    else if(rpc.params?.name==='paperbet_health')data=JSON.parse((await store.q("SELECT value FROM health WHERE key='settlement'").first())?.value||'null');
    else return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Unknown tool'}});
    result={content:[{type:'text',text:JSON.stringify(data)}]};
   }else if(rpc.method==='notifications/initialized')return new Response(null,{status:204});
   else return json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Unknown method'}});
   return json({jsonrpc:'2.0',id:rpc.id,result});
  }
  if(!url.pathname.startsWith('/api/')){const a=ASSETS[url.pathname];if(!a)return json({error:'Not found'},404);if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(a.body),c=>c.charCodeAt(0)),{headers:{...security,'Content-Type':a.type,'Cache-Control':url.pathname==='/sw.js'?'no-cache':'public,max-age=300'}});}
  const store=new D1Store(env.DB);
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  let body={};if(request.method==='POST'){
   if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'Cross-origin request blocked'},403);
   if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'Use application/json'},415);
   if(Number(request.headers.get('content-length'))>16000)return json({error:'Request too large'},413);
   const reader=request.body?.getReader();let text='',size=0;const decoder=new TextDecoder();if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16000){await reader.cancel();return json({error:'Request too large'},413);}text+=decoder.decode(value,{stream:true});}body=JSON.parse(text||'{}');
  }
  // The independent Site is owner-private. Sites service authorization protects this
  // updater; no simulated outcome input exists. Never expose it on a public Site.
  if(url.pathname==='/api/admin/settle'&&request.method==='POST')return json(await settleHosted(store,p));
  if(url.pathname.startsWith('/api/admin/'))return json({error:'Hosted reconciliation is unavailable; unresolved exceptions require reviewed implementation'},404);
  if(url.pathname==='/api/health'&&request.method==='GET')return json({version:'1.1.0',storage:'D1',source:p.source,settlement:JSON.parse((await store.q("SELECT value FROM health WHERE key='settlement'").first())?.value||'null')});
  const who=await identity(request,env.SESSION_SECRET),send=(data,status=200)=>json(data,status,who.cookie?{'Set-Cookie':who.cookie}:{}),user=who.user;
  if(url.pathname==='/api/state'&&request.method==='GET')return send({...await store.snapshot(user,Object.fromEntries(url.searchParams)),identityMode:request.headers.has('oai-authenticated-user-id')?'ChatGPT sign-in':'browser session',connected:true,source:p.source,quota:null,settlement:JSON.parse((await store.q("SELECT value FROM health WHERE key='settlement'").first())?.value||'null')});
  if(url.pathname==='/api/leagues'&&request.method==='GET')return send({leagues,configured:true});
  if(url.pathname==='/api/events'&&request.method==='GET'){const events=await p.events(url.searchParams.get('league'));return send({events,source:p.source,fetchedAt:Date.now(),coverage:p.coverage});}
  if(url.pathname==='/api/bets'&&request.method==='POST'){
   if(!/^[\w-]{16,100}$/.test(body.requestId||''))throw Error('Valid request identifier required');
   const duplicate=await store.duplicate(user,body.requestId);if(duplicate)return send({bet:duplicate});
   const stake=stakeCents(body.stake),event=await p.verify(body.league,body.eventId,body.bookmakerKey),outcome=event.outcomes.find(o=>o.name===body.selection);
   if(!outcome)throw Error('Selection no longer available');if(outcome.price!==body.odds)return send({error:'Odds changed. Review and accept the new price.',event,outcome},409);
   return send({bet:await store.place(user,body.requestId,event,outcome,stake,String(body.note||''),body.sessionId)},201);
  }
  if(url.pathname==='/api/reset'&&request.method==='POST'){if(body.confirmation!=='RESET')throw Error('Reset confirmation required');await store.reset(user,body.starting);return send({ok:true});}
  if(url.pathname==='/api/note'&&request.method==='POST'){await store.q('UPDATE bets SET note=? WHERE id=? AND user_id=?',String(body.note||'').slice(0,2000),body.id,user).run();return send({ok:true});}
  if(url.pathname==='/api/export'&&request.method==='GET')return send({exportedAt:new Date().toISOString(),...await store.snapshot(user),allBets:await store.all('SELECT * FROM bets WHERE user_id=?',user),transactions:await store.all('SELECT * FROM transactions WHERE user_id=?',user)});
  return json({error:'Not found'},404);
 }catch(e){const msg=String(e.message).replace(/^D1_ERROR: /,'').replace(/: SQLITE_CONSTRAINT.*$/,'');return json({error:/fetch failed/i.test(msg)?'Sports data connection failed. No bet was placed.':msg},400);}
}
export default {fetch:handle};
