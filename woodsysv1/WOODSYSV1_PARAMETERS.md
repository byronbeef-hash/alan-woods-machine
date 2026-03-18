# Woods System v1 — Parameters Reference

**Git tag:** `woodsysv1` (commit `a0efaf7`)
**Archive:** `archive/woodsysv1.zip`

---

## Kelly & Bet Sizing

| Parameter | Value | Description |
|-----------|-------|-------------|
| `KELLY_FRACTION` | 0.25 (25%) | Quarter-Kelly — conservative fraction of full Kelly criterion |
| `MAX_BET_FRACTION` | 0.10 (10%) | Maximum single bet as % of bankroll |
| `MIN_BET_SIZE` | $10 | Floor — bets below this are skipped |
| `STARTING_BANKROLL` | $5,000 | Initial bankroll |
| `COMMISSION_RATE` | 0.05 (5%) | Betfair exchange commission on net winnings |

### Tier Caps (max bet as % of bankroll per tier)

| Tier | Edge Required | Max Bet % |
|------|--------------|-----------|
| STRONG | >= 8% | 10% |
| MODERATE | >= 5% | 6% |
| MARGINAL | >= 3% | 3% |

### Commission-Adjusted Kelly Formula
```
b = decimal_odds - 1
effective_b = b * (1 - commission_rate)
p = model_probability
q = 1 - p
full_kelly = (effective_b * p - q) / effective_b
adjusted_kelly = full_kelly * KELLY_FRACTION
bet_size = bankroll * adjusted_kelly
```

---

## Model Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `LOOKBACK_GAMES` | 15 | Number of recent games weighted heavily |
| `SEASON_WEIGHT` | 0.30 | Weight given to full-season averages |
| `RECENT_WEIGHT` | 0.70 | Weight given to recent form (last 10-15 games) |
| `MIN_GAMES_PLAYED` | 10 | Minimum games a player needs to be modeled |
| `MIN_EDGE_THRESHOLD` | 0.03 (3%) | Minimum edge required to consider a bet |

### Statistical Models by Market

| Market Type | Distribution | Rationale |
|-------------|-------------|-----------|
| NBA Points | Gaussian | High volume (20-40/game), CLT applies |
| NBA Rebounds | Gaussian | Moderate volume (5-15/game) |
| NBA Assists | Gaussian | Moderate volume (3-12/game) |
| NBA Threes (FG3M) | Poisson | Low count discrete events (0-8/game) |
| NFL Passing/Rushing/Receiving Yards | Gaussian | High volume stats |
| NFL Touchdowns | Poisson | Low count discrete events |
| Soccer Goals | Poisson | Low count (0-3/game typical) |
| Soccer Shots on Target | Poisson | Low-moderate count |
| Soccer Assists | Poisson | Low count |

### Contextual Adjustments

| Adjustment | NBA | NFL | Soccer |
|-----------|-----|-----|--------|
| Home advantage | +0.5 * (home_avg - season_avg) | +5% | +10% |
| Away disadvantage | -0.5 * (away_avg - season_avg) | -4% | -10% |
| Back-to-back (<=1 rest day) | -3% | N/A | N/A |
| Well-rested (>=3 rest days) | +3% | N/A | N/A |
| Trend momentum | +0.2 * trend_direction | None | None |

### Probability Blending
The model blends statistical distribution estimates with empirical over-rates from the player's game log. More games played = more weight on empirical data.

---

## Overlay Finding

| Parameter | Value | Description |
|-----------|-------|-------------|
| `MIN_EDGE_THRESHOLD` | 3% | Minimum model_prob - market_implied to qualify |
| `STRONG_THRESHOLD` | 8% | Edge >= 8% is a STRONG overlay |
| `MODERATE_THRESHOLD` | 5% | Edge >= 5% is MODERATE |
| `MARGINAL_THRESHOLD` | 3% | Edge >= 3% is MARGINAL |

---

## Sport Adapters (v1)

### NBA (`basketball_nba`)
- **Data source:** `nba_api` Python library (free, no API key)
- **Stats:** Per-game logs with season/recent splits
- **Markets:** player_points, player_rebounds, player_assists, player_threes
- **Scan time:** 17:00 ET (5 PM, before evening games)
- **Game hours:** 18:00-01:00 ET

### EPL (`soccer_epl`) / UCL (`soccer_uefa_champions_league`)
- **Data source:** football-data.org API (free tier, 10 req/min)
- **Env var:** `FOOTBALL_DATA_API_KEY`
- **Markets:** player_goals, player_shots_on_target, player_soccer_assists
- **Scan time:** 06:00 ET (before European afternoon matches)
- **Game hours:** 07:00-17:00 ET

### NFL (`americanfootball_nfl`)
- **Data source:** `nfl_data_py` Python library (free, no API key)
- **Markets:** player_pass_yds, player_rush_yds, player_reception_yds, player_pass_tds, player_anytime_td
- **Scan time:** 11:00 ET (before Sunday games)
- **Game hours:** 13:00-23:00 ET
- **Season:** September-February only

---

## Odds Source

| Parameter | Value |
|-----------|-------|
| Provider | The Odds API |
| Base URL | `https://api.the-odds-api.com/v4` |
| Env var | `ODDS_API_KEY` |
| Free tier | 500 requests/month |
| Budget split | NBA ~200, EPL/UCL ~150, NFL ~150 |

---

## Infrastructure

| Component | Service | URL |
|-----------|---------|-----|
| Database | Supabase | `gqrqaaaqiowvinbfkkri.supabase.co` |
| Dashboard | Vercel | `woods-dashboard.vercel.app` |
| Code | GitHub | `github.com/byronbeef-hash/alan-woods-machine` |

### Supabase Tables
- `bets` — all bet records (pending + settled)
- `performance_snapshots` — daily summaries
- `system_config` — runtime configuration (key-value)

### Environment Variables Required
```
ODDS_API_KEY          — The Odds API key
SUPABASE_URL          — Supabase project URL
SUPABASE_KEY          — Supabase anon key
FOOTBALL_DATA_API_KEY — football-data.org API key
BETFAIR_USERNAME      — Betfair exchange (live mode only)
BETFAIR_PASSWORD      — Betfair exchange (live mode only)
BETFAIR_APP_KEY       — Betfair exchange (live mode only)
```

---

## P&L Calculation

**Win:** `pnl = bet_size * (odds_decimal - 1) * (1 - commission_rate)`
**Loss:** `pnl = -bet_size`

Commission only applies to net winnings (Betfair model). Losses are full stake.

---

## Schedule (v1 Default)

| Task | Time (ET) | Frequency |
|------|-----------|-----------|
| NBA scan | 17:00 | Daily |
| EPL scan | 06:00 | Match days |
| NFL scan | 11:00 | Game days (Sep-Feb) |
| Live monitor | Every 2 min | During game hours |
| Results report | 23:30 | Daily |
| Config cache refresh | Every 5 min | Continuous |
