import {decide,returns,statistics} from '../domain.js';
export class D1Store {
 constructor(db){this.db=db.withSession?db.withSession('first-primary'):db;}
 q(sql,...args){return this.db.prepare(sql).bind(...args);}
 async all(sql,...args){return (await this.q(sql,...args).all()).results;}
 async active(user){let s=await this.q('SELECT * FROM sessions WHERE user_id=? AND active=1',user).first();if(!s){await this.q('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?,?,1)',crypto.randomUUID(),user,100000,100000,Date.now()).run();s=await this.q('SELECT * FROM sessions WHERE user_id=? AND active=1',user).first();}return s;}
 async reset(user,starting){if(![10000,50000,100000,500000].includes(starting))throw Error('Unsupported starting bankroll');const id=crypto.randomUUID();await this.db.batch([this.q('UPDATE sessions SET active=0 WHERE user_id=?',user),this.q('INSERT INTO sessions VALUES(?,?,?,?,?,1)',id,user,starting,starting,Date.now())]);return id;}
 duplicate(user,key){return this.q('SELECT * FROM bets WHERE user_id=? AND request_id=?',user,key).first();}
 async place(user,key,event,outcome,stake,note,sessionId){
  const old=await this.duplicate(user,key);if(old)return old;
  if(!Number.isSafeInteger(stake)||stake<=0)throw Error('Invalid stake');returns(stake,outcome.price);
  if(event.start<=Date.now())throw Error('Pregame betting is closed');
  const id=crypto.randomUUID(),at=Date.now();
  // One SQL statement + triggers is the transaction. Concurrent requests cannot overspend.
  await this.q(`INSERT INTO bets(id,user_id,session_id,request_id,event_id,league,sport,home,away,start,selection,odds,stake,period,bookmaker,market,price_at,placed_at,status,note)
   SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',? WHERE NOT EXISTS(SELECT 1 FROM bets WHERE user_id=? AND request_id=?)`,id,user,sessionId,key,event.id,event.league,event.sport,event.home,event.away,event.start,outcome.name,outcome.price,stake,event.period,event.bookmaker,JSON.stringify({key:'h2h',period:event.period,outcomes:event.outcomes}),event.updated,at,String(note).slice(0,2000),user,key).run();
  return this.duplicate(user,key);
 }
 async settle(result,source){
  const payload=JSON.stringify({...result,source}),at=Date.now();
  const bets=await this.all("SELECT * FROM bets WHERE event_id=? AND league=? AND status IN ('open','live','unresolved')",result.id,result.sport_key);
  const statements=[this.q('INSERT INTO results VALUES(?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at',result.id,result.sport_key,payload,at)];
  for(const b of bets){const d=decide(b,result);statements.push(d?this.q("UPDATE bets SET status=?,payout=?,result=?,settled_at=?,checked_at=? WHERE id=? AND status IN ('open','live','unresolved')",d.status,d.payout,payload,at,at,b.id):this.q("UPDATE bets SET status=?,result=?,checked_at=? WHERE id=? AND status IN ('open','live','unresolved')",result.status==='live'?'live':'unresolved',payload,at,b.id));}
  await this.db.batch(statements);return bets.length;
 }
 async snapshot(user,filters={}){const active=await this.active(user),sessions=await this.all('SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC',user);const session=sessions.find(s=>s.id===filters.session)||active;let bets=await this.all('SELECT * FROM bets WHERE user_id=? AND session_id=? ORDER BY placed_at DESC',user,session.id);if(filters.sport)bets=bets.filter(b=>b.sport===filters.sport);if(filters.league)bets=bets.filter(b=>b.league===filters.league);if(filters.from)bets=bets.filter(b=>b.placed_at>=Date.parse(filters.from));if(filters.to)bets=bets.filter(b=>b.placed_at<Date.parse(filters.to)+86400000);const transactions=await this.all('SELECT * FROM transactions WHERE user_id=? AND session_id=? ORDER BY at',user,session.id);return {session:active,viewSession:session,sessions,bets,stats:statistics(bets,session,transactions)};}
}
