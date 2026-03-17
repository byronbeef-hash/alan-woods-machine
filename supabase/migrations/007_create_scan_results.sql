-- Woods System: Scan Results table
-- Stores all opportunities found by each scan run.
-- Auto-placed bets get marked PLACED with a reference to the bets table.

CREATE TABLE IF NOT EXISTS scan_results (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  scan_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  player TEXT NOT NULL,
  market TEXT NOT NULL,
  stat TEXT NOT NULL,
  side TEXT NOT NULL DEFAULT 'Over',
  line NUMERIC(6,1) NOT NULL,
  odds_american INTEGER,
  odds_decimal NUMERIC(8,4),
  model_prob NUMERIC(6,4),
  market_implied NUMERIC(6,4),
  edge NUMERIC(6,4),
  tier TEXT,
  confidence NUMERIC(5,3),
  kelly_pct NUMERIC(6,4),
  suggested_bet_size NUMERIC(10,2),
  home_team TEXT,
  away_team TEXT,
  game_time TIMESTAMPTZ,
  status TEXT DEFAULT 'ACTIVE',
  placed_bet_id BIGINT REFERENCES bets(id)
);

CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id);
CREATE INDEX IF NOT EXISTS idx_scan_results_status ON scan_results(status, game_time);
CREATE INDEX IF NOT EXISTS idx_scan_results_sport ON scan_results(sport);
