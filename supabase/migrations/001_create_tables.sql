-- Woods System — Supabase Schema
-- Run this in the Supabase SQL editor to set up the database

-- Bets table: every bet placed (paper or real)
CREATE TABLE IF NOT EXISTS bets (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    player TEXT NOT NULL,
    market TEXT NOT NULL,
    stat TEXT NOT NULL,
    side TEXT NOT NULL CHECK (side IN ('Over', 'Under')),
    line NUMERIC(6,1) NOT NULL,
    odds_american INTEGER,
    odds_decimal NUMERIC(8,4),
    model_prob NUMERIC(6,4),
    market_implied NUMERIC(6,4),
    edge NUMERIC(6,4),
    tier TEXT CHECK (tier IN ('STRONG', 'MODERATE', 'MARGINAL')),
    bet_size NUMERIC(10,2),
    bankroll_at_bet NUMERIC(10,2),
    result TEXT DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'WIN', 'LOSS')),
    actual_stat NUMERIC(6,1),
    pnl NUMERIC(10,2),
    running_bankroll NUMERIC(10,2),
    notes TEXT
);

-- Performance snapshots: daily summaries
CREATE TABLE IF NOT EXISTS performance_snapshots (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    date DATE NOT NULL,
    total_bets INTEGER,
    win_rate NUMERIC(5,4),
    total_pnl NUMERIC(10,2),
    roi NUMERIC(8,4),
    bankroll NUMERIC(10,2)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bets_result ON bets(result);
CREATE INDEX IF NOT EXISTS idx_bets_player ON bets(player);
CREATE INDEX IF NOT EXISTS idx_bets_created ON bets(created_at);
CREATE INDEX IF NOT EXISTS idx_bets_tier ON bets(tier);
CREATE INDEX IF NOT EXISTS idx_snapshots_date ON performance_snapshots(date);

-- Enable Row Level Security (public access for now — tighten for production)
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_snapshots ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role access bets" ON bets
    FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role access snapshots" ON performance_snapshots
    FOR ALL USING (true) WITH CHECK (true);
