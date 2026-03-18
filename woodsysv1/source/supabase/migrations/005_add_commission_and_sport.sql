-- Add commission rate per bet and sport identifier
ALTER TABLE bets ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5,4) DEFAULT 0.05;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS sport TEXT DEFAULT 'basketball_nba';
CREATE INDEX IF NOT EXISTS idx_bets_sport ON bets(sport);
