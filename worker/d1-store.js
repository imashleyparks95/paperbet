import {decide,returns,statistics,parlayOdds,decideParlay} from '../domain.js';
export class D1Store {
 constructor(db){this.db=db.withSession?db.withSession('first-primary'):db;}
 q(sql,...args){return this.db.prepare(sql).bind(...args);}
 async all(sql,...args){return (await this.q(sql,...args).all()).results;}
 async active(user){let s=await this.q('SELECT * FROM sessions WHERE user_id=? AND active=1',user).first();if(!s){await this.q('INSERT OR IGNORE INTO sessions VALUES(?,?,?,?,?,1)',crypto.randomUUID(),user,100000,100000,Date.now()).run();s=await this.q('SELECT * FROM sessions WHERE user_id=? AND active=1',user).first();}return s;}
 async reset(user,starting){if(![10000,50000,100000,500000].includes(starting))throw Error('Unsupported starting bankroll');const id=crypto.randomUUID();await this.db.batch([this.q('UPDATE sessions SET active=0 WHERE user_id=?',user),this.q('INSERT INTO sessions VALUES(?,?,?,?,?,1)',id,user,starting,starting,Date.now())]);return id;}
 duplicate(user,key){return this.q('SELECT * FROM bets WHERE user_id=? AND request_id=?',user,key).first();}
 async placeParlay(user,key,legs,stake,note,sessionId){
  const old=await this.duplicate(user,key);if(old)return old;
  const odds=parlayOdds(legs);returns(stake,odds);if(legs.some(l=>l.event.start<=Date.now()))throw Error('A game has started. Parlay betting is closed');
  const id=crypto.randomUUID(),at=Date.now(),snapshots=legs.map(({event:e,outcome:o})=>({event_id:e.id,league:e.league,sport:e.sport,home:e.home,away:e.away,start:e.start,selection:o.name,odds:o.price,period:e.period,bookmaker:e.bookmaker,outcomes:e.outcomes,price_at:e.updated}));
  const statements=[this.q(`INSERT INTO bets(id,user_id,session_id,request_id,event_id,league,sport,home,away,start,selection,odds,stake,period,bookmaker,market,price_at,placed_at,status,note) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',? WHERE NOT EXISTS(SELECT 1 FROM bets WHERE user_id=? AND request_id=?)`,id,user,sessionId,key,'parlay:'+id,'parlay','Parlay',legs.length+'-leg parlay','',Math.min(...snapshots.map(l=>l.start)),snapshots.map(l=>l.selection).join(' + '),odds,stake,'per_leg','Published leg prices',JSON.stringify({key:'parlay',legs:snapshots}),at,at,String(note).slice(0,2000),user,key)];
  snapshots.forEach((l,i)=>statements.push(this.q(`INSERT INTO bet_legs(bet_id,leg_index,event_id,league,sport,home,away,start,selection,odds,period,bookmaker,market,price_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM bets WHERE id=?)`,id,i,l.event_id,l.league,l.sport,l.home,l.away,l.start,l.selection,l.odds,l.period,l.bookmaker,JSON.stringify({key:'h2h',outcomes:l.outcomes}),l.price_at,id)));
  await this.db.batch(statements);return this.duplicate(user,key);
 }
 async dueEvents(now=Date.now()){
  return this.all(`SELECT event_id,league,MIN(checked_at) AS last_checked FROM (
   SELECT event_id,league,checked_at FROM bets WHERE status IN ('open','live','unresolved') AND league<>'parlay' AND start<=? AND checked_at<?
   UNION ALL SELECT event_id,league,checked_at FROM bet_legs WHERE status IN ('open','live','unresolved') AND start<=? AND checked_at<?
  ) GROUP BY event_id,league ORDER BY last_checked LIMIT 20`,now,now-240000,now,now-240000);
 }
 async markChecked(eventId,league){await this.db.batch([this.q('UPDATE bets SET checked_at=? WHERE event_id=? AND league=?',Date.now(),eventId,league),this.q('UPDATE bet_legs SET checked_at=? WHERE event_id=? AND league=?',Date.now(),eventId,league)]);}
 async recoverParlays(){
  // Recover a Worker interruption between recording a final leg and paying its ticket.
  const ready=await this.all("SELECT b.* FROM bets b WHERE b.league='parlay' AND b.status IN ('open','live','unresolved') AND (EXISTS(SELECT 1 FROM bet_legs l WHERE l.bet_id=b.id AND l.status='lost') OR NOT EXISTS(SELECT 1 FROM bet_legs l WHERE l.bet_id=b.id AND l.status NOT IN ('won','void'))) LIMIT 100");
  for(const b of ready){const legs=await this.all('SELECT * FROM bet_legs WHERE bet_id=? ORDER BY leg_index',b.id);if(!legs.length)continue;const d=decideParlay(b,legs);if(d)await this.q("UPDATE bets SET status=?,payout=?,result=?,settled_at=? WHERE id=? AND status IN ('open','live','unresolved')",d.status,d.payout,JSON.stringify({source:'ESPN public scoreboard / accepted leg results',legs}),Date.now(),b.id).run();}
 }
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
  const legRows=await this.all("SELECT * FROM bet_legs WHERE event_id=? AND league=? AND status IN ('open','live','unresolved')",result.id,result.sport_key);
  for(const l of legRows){const d=decide({...l,stake:1},result);statements.push(this.q("UPDATE bet_legs SET status=?,result=?,checked_at=? WHERE bet_id=? AND leg_index=? AND status IN ('open','live','unresolved')",d?.status||(result.status==='live'?'live':'unresolved'),payload,at,l.bet_id,l.leg_index));}
  await this.db.batch(statements);
  for(const id of new Set(legRows.map(l=>l.bet_id))){const b=await this.q('SELECT * FROM bets WHERE id=?',id).first(),legs=await this.all('SELECT * FROM bet_legs WHERE bet_id=? ORDER BY leg_index',id),d=decideParlay(b,legs);if(d)await this.q("UPDATE bets SET status=?,payout=?,result=?,settled_at=? WHERE id=? AND status IN ('open','live','unresolved')",d.status,d.payout,JSON.stringify({source,legs}),at,id).run();else await this.q("UPDATE bets SET status=? WHERE id=? AND status IN ('open','live','unresolved')",legs.some(l=>l.status==='live')?'live':legs.some(l=>l.status==='unresolved')?'unresolved':'open',id).run();}
  return bets.length+legRows.length;
 }
 async snapshot(user,filters={}){const active=await this.active(user),sessions=await this.all('SELECT * FROM sessions WHERE user_id=? ORDER BY created_at DESC',user);const session=sessions.find(s=>s.id===filters.session)||active;let bets=await this.all('SELECT * FROM bets WHERE user_id=? AND session_id=? ORDER BY placed_at DESC',user,session.id);if(filters.sport)bets=bets.filter(b=>b.sport===filters.sport);if(filters.league)bets=bets.filter(b=>b.league===filters.league);if(filters.from)bets=bets.filter(b=>b.placed_at>=Date.parse(filters.from));if(filters.to)bets=bets.filter(b=>b.placed_at<Date.parse(filters.to)+86400000);const transactions=await this.all('SELECT * FROM transactions WHERE user_id=? AND session_id=? ORDER BY at',user,session.id);const legs=await this.all('SELECT l.* FROM bet_legs l JOIN bets b ON b.id=l.bet_id WHERE b.user_id=? AND b.session_id=? ORDER BY l.leg_index',user,session.id);bets=bets.map(b=>({...b,legs:legs.filter(l=>l.bet_id===b.id)}));return {session:active,viewSession:session,sessions,bets,stats:statistics(bets,session,transactions)};}
}
