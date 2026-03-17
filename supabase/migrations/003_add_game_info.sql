-- Add game context columns to bets table
ALTER TABLE bets ADD COLUMN IF NOT EXISTS home_team TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS away_team TEXT;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS game_time TIMESTAMPTZ;
