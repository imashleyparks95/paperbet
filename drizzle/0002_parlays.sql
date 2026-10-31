CREATE TABLE bet_legs(
 bet_id TEXT NOT NULL REFERENCES bets(id),
 leg_index INTEGER NOT NULL,
 event_id TEXT NOT NULL,
 league TEXT NOT NULL,
 sport TEXT NOT NULL,
 home TEXT NOT NULL,
 away TEXT NOT NULL,
 start INTEGER NOT NULL,
 selection TEXT NOT NULL,
 odds REAL NOT NULL,
 period TEXT NOT NULL,
 bookmaker TEXT NOT NULL,
 market TEXT NOT NULL,
 price_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 result TEXT,
 checked_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(bet_id,leg_index),UNIQUE(bet_id,event_id)
);
--> statement-breakpoint
CREATE INDEX leg_checks ON bet_legs(status,checked_at,start);
