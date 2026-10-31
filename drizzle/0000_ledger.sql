CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,starting INTEGER NOT NULL,balance INTEGER NOT NULL CHECK(balance>=0),created_at INTEGER NOT NULL,active INTEGER NOT NULL);
--> statement-breakpoint
 CREATE UNIQUE INDEX IF NOT EXISTS one_active ON sessions(user_id) WHERE active=1;
--> statement-breakpoint
 CREATE TABLE IF NOT EXISTS bets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES sessions(id),request_id TEXT NOT NULL,event_id TEXT NOT NULL,league TEXT NOT NULL,sport TEXT NOT NULL,home TEXT NOT NULL,away TEXT NOT NULL,start INTEGER NOT NULL,selection TEXT NOT NULL,odds REAL NOT NULL,stake INTEGER NOT NULL,period TEXT NOT NULL,bookmaker TEXT NOT NULL,market TEXT NOT NULL,price_at INTEGER NOT NULL,placed_at INTEGER NOT NULL,status TEXT NOT NULL,payout INTEGER NOT NULL DEFAULT 0,settled_at INTEGER,result TEXT,note TEXT NOT NULL DEFAULT '', UNIQUE(user_id,request_id));
--> statement-breakpoint
 CREATE TABLE IF NOT EXISTS transactions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,session_id TEXT NOT NULL,bet_id TEXT,kind TEXT NOT NULL,amount INTEGER NOT NULL,balance INTEGER NOT NULL,at INTEGER NOT NULL,UNIQUE(bet_id,kind));
--> statement-breakpoint
 CREATE TABLE IF NOT EXISTS results(event_id TEXT PRIMARY KEY,league TEXT NOT NULL,payload TEXT NOT NULL,observed_at INTEGER NOT NULL);
--> statement-breakpoint
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,event_id TEXT,actor TEXT NOT NULL,reason TEXT NOT NULL,before TEXT,after TEXT NOT NULL,at INTEGER NOT NULL);
--> statement-breakpoint
 CREATE TABLE IF NOT EXISTS health(key TEXT PRIMARY KEY,value TEXT NOT NULL);
--> statement-breakpoint
 
