export const leagues = [
 ['americanfootball_nfl','NFL','Football','including_overtime'],['americanfootball_ncaaf','College football','Football','including_overtime'],
 ['basketball_nba','NBA','Basketball','including_overtime'],['basketball_ncaab','College basketball','Basketball','including_overtime'],
 ['baseball_mlb','MLB','Baseball','including_extra_innings'],['icehockey_nhl','NHL','Hockey','including_shootout'],
 ...[['soccer_epl','Premier League'],['soccer_uefa_champs_league','Champions League'],['soccer_spain_la_liga','La Liga'],['soccer_germany_bundesliga','Bundesliga'],['soccer_italy_serie_a','Serie A'],['soccer_france_ligue_one','Ligue 1'],['soccer_usa_mls','MLS']].map(([k,n])=>[k,n,'Soccer','regulation_90'])
].map(([key,name,sport,period])=>({key,name,sport,period}));
export function american(decimal) { return decimal>=2 ? Math.round((decimal-1)*100) : Math.round(-100/(decimal-1)); }
export function returns(stake,decimal) { if(!Number.isSafeInteger(stake)||stake<=0||!Number.isFinite(decimal)||decimal<=1) throw Error('Invalid stake or odds');const payout=Math.round(stake*decimal);if(!Number.isSafeInteger(payout))throw Error('Potential return exceeds supported limits');return payout; }
export function parlayOdds(legs){if(!Array.isArray(legs)||legs.length<2||legs.length>8)throw Error('Choose 2–8 legs from different games');if(new Set(legs.map(l=>l.event_id||l.event?.id)).size!==legs.length)throw Error('Only one selection per game is allowed; same-game parlays are not supported');const price=legs.reduce((n,l)=>{const d=l.odds??l.outcome?.price;if(!Number.isFinite(d)||d<=1)throw Error('Invalid parlay odds');return n*d;},1);if(!Number.isFinite(price))throw Error('Invalid parlay odds');return price;}
export function decideParlay(bet,legs){
 if(legs.some(l=>l.status==='lost'))return {status:'lost',payout:0};
 if(legs.some(l=>!['won','void'].includes(l.status)))return null;
 const remaining=legs.filter(l=>l.status==='won');if(!remaining.length)return {status:'void',payout:bet.stake};
 return {status:'won',payout:returns(bet.stake,remaining.reduce((n,l)=>n*l.odds,1))};
}
export function stakeCents(value){ if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(value))) throw Error('Enter a valid amount with at most two decimals'); const cents=Math.round(Number(value)*100);if(cents<=0)throw Error('Stake must be positive');return cents; }
// Unknown or ambiguous finals stay unresolved; no missing-result loss or time-based void.
export function decide(bet,result){
 if(result.id!==bet.event_id||result.sport_key!==bet.league) return null;
 if(['canceled','abandoned','voided'].includes(result.status)&&result.authoritative===true&&result.voidConfirmed===true) return {status:'void',payout:bet.stake};
 if(!result.completed||result.status!=='final'||result.period!==bet.period||!result.authoritative) return null;
 if(!Array.isArray(result.scores)||result.scores.length!==2)return null;
 const home=result.scores.find(s=>s.name===bet.home),away=result.scores.find(s=>s.name===bet.away);
 if(!home||!away||home.score===null||away.score===null||!/^\d+$/.test(String(home.score))||!/^\d+$/.test(String(away.score)))return null;
 const h=Number(home.score),a=Number(away.score);
 if(h===a&&bet.period!=='regulation_90') { if(bet.league==='americanfootball_nfl') return {status:'void',payout:bet.stake}; return null; }
 const winner=h===a?'Draw':h>a?bet.home:bet.away;
 const won=winner===bet.selection;
 return {status:won?'won':'lost',payout:won?returns(bet.stake,bet.odds):0};
}
export function statistics(bets,session,transactions){
 const settled=bets.filter(b=>['won','lost'].includes(b.status)),wins=settled.filter(b=>b.status==='won').length;
 const stakes=settled.reduce((n,b)=>n+b.stake,0),net=settled.reduce((n,b)=>n+b.payout-b.stake,0);
 let w=0,l=0,maxW=0,maxL=0;for(const b of [...settled].sort((a,b)=>a.settled_at-b.settled_at)){if(b.status==='won'){w++;l=0;}else{l++;w=0;}maxW=Math.max(w,maxW);maxL=Math.max(l,maxL);}
 return {starting:session.starting,balance:session.balance,totalStakes:bets.reduce((n,b)=>n+b.stake,0),net,bets:bets.length,wins,losses:settled.length-wins,voids:bets.filter(b=>b.status==='void').length,winPct:settled.length?wins/settled.length*100:0,roi:stakes?net/stakes*100:0,averageOdds:bets.length?bets.reduce((n,b)=>n+b.odds,0)/bets.length:null,maxW,maxL,history:transactions};
}
