-- System configuration table for dashboard-editable settings
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to system_config" ON system_config
    FOR ALL USING (true) WITH CHECK (true);

-- Seed default values
INSERT INTO system_config (key, value) VALUES
    ('kelly_fraction', '0.25'),
    ('commission_rate', '0.05'),
    ('min_edge_threshold', '0.03'),
    ('min_bet_size', '10'),
    ('max_bet_fraction', '0.10'),
    ('tier_cap_strong', '0.10'),
    ('tier_cap_moderate', '0.06'),
    ('tier_cap_marginal', '0.03'),
    ('starting_bankroll', '5000'),
    ('active_sports', '["basketball_nba"]')
ON CONFLICT (key) DO NOTHING;
