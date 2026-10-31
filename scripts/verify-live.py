"""Authenticated live verification; credentials only arrive on hidden stdin.
Creates genuine virtual bets in an isolated service-cookie account, never fixtures.
"""
import sys,json,urllib.request,urllib.error,http.cookiejar,uuid
print("Ready for live API tests",flush=True)
c=json.loads(sys.stdin.readline())
jar=http.cookiejar.CookieJar()
op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
h={"OAI-Sites-Authorization":"Bearer "+c["token"]}
def req(path,data=None):
    hh=dict(h); body=None
    if data is not None: hh["Content-Type"]="application/json"; body=json.dumps(data).encode()
    try:
        r=op.open(urllib.request.Request(c["url"]+path,data=body,headers=hh),timeout=60)
        return r.status,json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read())
s,st=req("/api/state"); assert s==200,st
initial=st["session"]["balance"]; print("Initial persisted bankroll",initial,flush=True)
s,d=req("/api/events?league=basketball_nba"); assert s==200,d
assert d["events"],"No genuine upcoming NBA moneylines"
e=d["events"][0]; o=e["outcomes"][0]
b={"requestId":str(uuid.uuid4()),"sessionId":st["session"]["id"],"eventId":e["id"],"league":e["league"],"bookmakerKey":e["bookmakerKey"],"selection":o["name"],"odds":o["price"]+0.01,"stake":"1.00","note":"Deployment verification: genuine ESPN event, $1 fictional stake, isolated service-session ledger"}
s,d=req("/api/bets",b); assert s==409,(s,d)
_,check=req("/api/state"); assert check["session"]["balance"]==initial
print("Live odds-change rejection without debit",s,flush=True)
b["odds"]=d["outcome"]["price"]
s,accepted=req("/api/bets",b); assert s in (200,201),(s,accepted)
s,retry=req("/api/bets",b); assert s==200 and retry["bet"]["id"]==accepted["bet"]["id"]
_,final=req("/api/state"); assert final["session"]["balance"]==initial-100 and len(final["bets"])==1
print("Genuine $1 practice bet accepted; repeated request debited once; persisted balance",final["session"]["balance"],flush=True)
s,health=req("/api/admin/settle",{}); assert s==200,(s,health)
_,rd=req("/api/health"); assert rd["settlement"]["checkedAt"]==health["checkedAt"]
print("Unattended updater and persisted health readback",health,flush=True)
for path in ["/manifest.webmanifest","/sw.js","/icon-192.png","/apple-touch-icon.png"]:
    r=op.open(urllib.request.Request(c["url"]+path,headers=h),timeout=30); assert r.status==200
    print("PWA asset",path,r.headers.get("Content-Type"),flush=True)
report={"version":"1.1.0","url":c["url"],"genuinePracticeEvent":accepted["bet"]["event_id"],"oddsChangeStatus":409,"duplicateDebit":False,"persistedBalance":final["session"]["balance"],"settlement":health,"liveFinalPayoutVerified":False,"physicalIPhoneVerified":False,"notes":"Genuine future event has not finished. Test account isolated from signed-in owner. No simulated live odds or results."}
from pathlib import Path
Path("docs/live-deployment.json").write_text(json.dumps(report,indent=2)+"\n")
print("LIVE API CHECKS PASSED; genuine future result still pending",flush=True)
