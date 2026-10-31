CREATE TRIGGER session_start AFTER INSERT ON sessions BEGIN
 INSERT INTO transactions VALUES(lower(hex(randomblob(16))),NEW.user_id,NEW.id,NULL,'start',NEW.starting,NEW.balance,NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER bet_validate BEFORE INSERT ON bets BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM sessions WHERE id=NEW.session_id AND user_id=NEW.user_id AND active=1) THEN RAISE(ABORT,'Practice session changed. Refresh before betting') END;
 SELECT CASE WHEN NEW.stake<=0 OR NEW.stake!=(CAST(NEW.stake AS INTEGER)) OR NEW.odds<=1 THEN RAISE(ABORT,'Invalid stake or odds') END;
 SELECT CASE WHEN (SELECT balance FROM sessions WHERE id=NEW.session_id)<NEW.stake THEN RAISE(ABORT,'Insufficient virtual balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER bet_debit AFTER INSERT ON bets BEGIN
 UPDATE sessions SET balance=balance-NEW.stake WHERE id=NEW.session_id;
 INSERT INTO transactions SELECT lower(hex(randomblob(16))),NEW.user_id,NEW.session_id,NEW.id,'stake',-NEW.stake,balance,NEW.placed_at FROM sessions WHERE id=NEW.session_id;
END;
--> statement-breakpoint
CREATE TRIGGER bet_settle AFTER UPDATE OF status,payout ON bets WHEN NEW.status IN ('won','lost','void') AND OLD.status IN ('open','live','unresolved') BEGIN
 UPDATE sessions SET balance=balance+NEW.payout WHERE id=NEW.session_id;
 INSERT INTO transactions SELECT lower(hex(randomblob(16))),NEW.user_id,NEW.session_id,NEW.id,'settlement',NEW.payout,balance,NEW.settled_at FROM sessions WHERE id=NEW.session_id;
END;
--> statement-breakpoint
CREATE TABLE jobs(key TEXT PRIMARY KEY,lease_until INTEGER NOT NULL);
--> statement-breakpoint
ALTER TABLE bets ADD COLUMN checked_at INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX pending_checks ON bets(status,checked_at,start);
