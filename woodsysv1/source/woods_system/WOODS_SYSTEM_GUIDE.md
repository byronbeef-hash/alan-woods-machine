# The Woods System — Complete Guide

**Named after Alan Woods (1945–2008), who turned mathematics and disciplined bet-sizing into a $200M+ fortune on the Hong Kong horse races.**

*"We only bet when the public has mispriced the odds."*

---

## Part 1: The Story of Alan Woods

### Background

Alan Woods studied mathematics at the University of New England in Australia. Though he only attended lectures seriously for one semester and eventually got kicked out, a test during an actuarial course showed his mathematical ability was "off the scale" even among actuaries.

His gambling career began with card-counting in the early 1970s. He mastered blackjack, won US$100,000 in Las Vegas within six months, and spent years as a globe-trotting card-counter before retiring from that in 1982.

### The Hong Kong System

In 1984, Alan moved to Hong Kong with Bill Benter (the programmer) and Wally Sommons (the database compiler), putting up 60% of a US$150,000 bankroll. They started with a simple "favourites system" but quickly realised the real edge was in betting only on **overlays** — horses the public had under-bet, creating inflated odds.

Bill built the computer model. Alan and his team identified all the factors that decide races — gender, track, distance, weight, last-start result, barrier position — and assigned each a mathematical coefficient in their formula. What made it powerful was getting the *weighting* right. They also employed expert analysts to watch every horse in every race, scoring subjective factors: bad rides, whether a horse wasn't being tried, premature speed, late closing speed. All of this fed into the model.

### How It Worked

The formula produced a **probability for every horse in every race**, expressed to three decimal places. They then compared that probability against the public's odds using **Win Expectation**:

```
Win Expectation = Model Probability × Decimal Odds
```

- Greater than 1.0 = overlay (bet)
- Less than 1.0 = underlay (avoid)

Given Hong Kong's 18% government rake, small overlays weren't enough — they needed massive ones. And because the public bets sentimentally (lucky numbers, nice names, tips heard at discos), there was usually at least one per race.

### The Early Struggle

The first two years were brutal. They wiped out the $150,000 bankroll. Alan injected another $60,000 of his own money — more than half his net worth. Wally lost his nerve and left. But Alan and Bill persisted, and in 1987 the model finally started winning: US$100,000 that season.

That same year, Alan and Bill split bitterly over control of bet-sizing. Alan kept refining independently.

### The Feedback Loop

After the split, Alan employed a dozen staff scattered across Asia and Australasia to review every horse every time it ran. The data flowed into an email inbox, got plugged into the model, and the coefficients were continuously updated. After each race meeting, results were played back through the model — if they justified changing any weighting, the change became permanent. As Alan put it, with each race the computer got **"smarter."**

### Bet Sizing: Kelly Criterion

Alan adopted **Kelly's Criterion**: bet to win a percentage of bankroll equal to your percentage advantage on each wager. In practice, his team bet at about **two-thirds Kelly** to smooth out volatility while still capturing roughly 90% of maximum theoretical profit.

### The Result

By the time of his peak, Alan's net worth was somewhere between A$200 million and A$500 million, nearly all of it won on the horses. His team (Libertarian Investment Limited) would sometimes invest HK$14 million (~A$2.4 million) on a single nine-race card. Alan passed away in Hong Kong in January 2008 at age 62.

---

## Part 2: Building a Modern Equivalent

### The Five Non-Negotiable Ingredients

Alan's edge came from five things. Any modern system needs all five:

1. **An inefficient market** where the crowd systematically misprices things
2. **Better data** than your opponents
3. **A mathematical model** that converts data into probabilities
4. **Disciplined bet-sizing** via Kelly Criterion
5. **Enough liquidity** to place large wagers without moving the price

### Where These Conditions Exist Today

#### US Sports Player Props (Our Focus)
Sportsbooks set thousands of player prop lines every day (will Mahomes throw over/under 275.5 yards, will Doncic score over/under 28.5 points). They can't dedicate serious analytical firepower to every single line. The result is systematic mispricing, especially in NBA, NFL, and MLB player props. The US market now handles tens of billions annually, so liquidity is there.

#### Other Opportunities
- **Prediction markets** (Polymarket, Kalshi) — unsophisticated participants, growing liquidity
- **Esports and niche sports** — weakest book pricing, lower liquidity
- **Crypto/DeFi** — arbitrage, liquidation prediction, MEV strategies

### Why Player Props?

- Highest volume of mispriced lines
- Most accessible data (NBA API is free)
- Books set lines algorithmically with limited human oversight
- Multiple books to shop for best odds
- Lower limits than main lines, but sufficient for building a bankroll

---

## Part 3: The Woods System — Technical Architecture

### System Overview

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│ Data Pipeline│────▶│  Prediction  │────▶│ Overlay Finder │
│ (NBA + Odds) │     │    Model     │     │ (Model vs Mkt) │
└─────────────┘     └──────────────┘     └───────┬────────┘
                                                  │
                    ┌──────────────┐     ┌────────▼────────┐
                    │   Tracker    │◀────│  Kelly Sizer    │
                    │ (Performance)│     │  (Bet Sizing)   │
                    └──────┬───────┘     └────────┬────────┘
                           │                      │
                    ┌──────▼───────┐     ┌────────▼────────┐
                    │  Calibration │     │  Auto-Bettor    │
                    │  (Feedback)  │     │  (Execution)    │
                    └──────────────┘     └────────┬────────┘
                                                  │
                                         ┌────────▼────────┐
                                         │  Notifications  │
                                         │ (Telegram/Email)│
                                         └─────────────────┘
```

### The Six Core Modules

#### 1. `data_pipeline.py` — Data Ingestion
Alan's equivalent: a dozen analysts scattered across Asia watching every horse.

- Fetches player game logs from the NBA API (every game, every stat)
- Calculates rolling averages (5-game, 10-game windows)
- Computes home/away splits, rest-day impact, trend detection
- Fetches live odds from The Odds API across all sportsbooks
- Converts American odds to decimal odds and implied probabilities

#### 2. `model.py` — Probability Engine
Alan's equivalent: the formula with coefficients for every factor.

- Estimates probability of Over/Under for each player prop
- Uses distribution fitting (Gaussian for pts/reb/ast, Poisson for threes)
- Weights recent form (70%) vs season averages (30%) — configurable
- Applies contextual adjustments:
  - Home court advantage
  - Back-to-back fatigue
  - Rest day boost
  - Trend momentum
- Blends parametric model with empirical rates
- Outputs probability to four decimal places (like Alan's three)
- Includes confidence score based on sample size and consistency

#### 3. `overlay_finder.py` — Overlay Detection
Alan's equivalent: comparing his probability to the tote board.

- Compares model probability to market-implied probability
- Calculates edge: `Edge = Model Prob - Market Implied Prob`
- Calculates Win Expectation: `WinExp = Model Prob × Decimal Odds`
- Classifies overlays by tier:
  - **STRONG**: 8%+ edge (rare, bet aggressively)
  - **MODERATE**: 5-8% edge (solid overlay)
  - **MARGINAL**: 3-5% edge (minimum threshold)
- Checks both Over and Under sides for each prop

#### 4. `kelly.py` — Bet Sizing
Alan's equivalent: Kelly Criterion at two-thirds fraction.

- Full Kelly formula: `f* = (bp - q) / b`
  - b = decimal odds - 1
  - p = model win probability
  - q = 1 - p
- Applies fractional Kelly (default: 25%, configurable)
- Portfolio-level constraints:
  - Max 5% of bankroll on any single bet
  - Max 20% total exposure across all bets
  - Minimum bet size floor

#### 5. `tracker.py` — Performance & Calibration
Alan's equivalent: replaying each race meeting through the model.

- Records every bet with full context (model prob, market implied, edge, tier)
- Tracks outcomes and calculates P&L
- Generates performance reports:
  - Win rate, ROI, profit factor
  - Max drawdown
  - Performance by overlay tier
- **Model calibration check**: do our 60% predictions win 60% of the time?
  - This is the single most important diagnostic
  - If miscalibrated, adjust model parameters

#### 6. `auto_bettor.py` — Automated Execution
Alan's equivalent: sending staff to the Jockey Club windows.

- Pluggable exchange architecture (Betfair, DryRun, extensible)
- Safety features:
  - Maximum daily loss limit
  - Odds drift tolerance
  - Rate limiting
  - Full audit trail
- DryRun mode for paper trading (start here!)

#### 7. `notifications.py` — Alerts
- Telegram bot: real-time overlay alerts, bet confirmations, results
- Email: daily HTML report with full performance summary
- Error alerts if anything goes wrong

#### 8. `config.py` — All Settings
Every parameter in one place — bankroll, Kelly fraction, edge thresholds, API keys.

---

## Part 4: Getting Started

### Step 1: Prerequisites (5 minutes)

Install Python 3.10+ on your machine. Then install dependencies:

```bash
cd woods_system
pip install nba_api requests pandas numpy scipy scikit-learn xgboost tabulate
```

### Step 2: API Keys (5 minutes)

**The Odds API** (required for live odds):
1. Go to https://the-odds-api.com
2. Create a free account (500 requests/month)
3. Copy your API key
4. Paste into `config.py` as `ODDS_API_KEY`

**Telegram Bot** (for notifications):
1. Open Telegram, search for @BotFather
2. Send `/newbot`, follow prompts, copy your bot token
3. Send any message to your new bot
4. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
5. Copy the `chat_id` from the response
6. Set as environment variables: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

**Betfair** (for auto-betting — optional, start with DryRun):
1. Create account at betfair.com
2. Get API credentials at https://developer.betfair.com
3. Set env vars: `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`, `BETFAIR_APP_KEY`

### Step 3: Paper Trade First (2-3 weeks)

This is critical. Alan lost his entire bankroll before his model worked.

```bash
# Scan today's props for overlays
python main.py scan

# Generate a bet card with Kelly sizing
python main.py bet

# After games finish, record results
python main.py result

# Check your performance
python main.py report

# Or run the demo backtest to see the system in action
python main.py backtest
```

Run `scan` and `bet` before each night's NBA games. Record results the next morning. After 50-100 paper bets, check the performance report. If the model is calibrated and profitable, you can start with real money.

### Step 4: Go Live

When paper trading shows consistent profitability:

1. Open accounts on **DraftKings, FanDuel, and BetMGM** (multiple books lets you shop for best odds)
2. Start with a small bankroll ($1,000-5,000)
3. Use the bet card output — it tells you exactly what to bet and how much
4. Continue recording results and monitoring calibration

### Step 5: Cloud Automation

To run this fully automated in the cloud:

1. **Containerise** with the included Dockerfile
2. **Deploy** to Railway, AWS, DigitalOcean, or any cloud provider
3. **Schedule** daily runs before tip-off using cron/Cloud Scheduler
4. **Auto-bet** via Betfair API or keep it as Telegram recommendations
5. **Monitor** via daily performance reports

---

## Part 5: Configuration Reference

### `config.py` Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `STARTING_BANKROLL` | $5,000 | Paper-trade starting bankroll |
| `KELLY_FRACTION` | 0.25 | Quarter-Kelly (Alan used 0.67) |
| `MIN_EDGE_THRESHOLD` | 0.03 | Minimum 3% edge to bet |
| `MAX_BET_FRACTION` | 0.05 | Max 5% of bankroll per bet |
| `LOOKBACK_GAMES` | 15 | Recent games for form weighting |
| `SEASON_WEIGHT` | 0.30 | Weight for full-season averages |
| `RECENT_WEIGHT` | 0.70 | Weight for recent form |
| `MIN_GAMES_PLAYED` | 10 | Min games before modelling a player |

### Tuning the Model

After collecting results, adjust these based on calibration:

- **If model is overconfident** (predicting 60% but winning 52%): raise `MIN_EDGE_THRESHOLD`, lower `RECENT_WEIGHT`
- **If model is underconfident** (predicting 55% but winning 62%): lower `MIN_EDGE_THRESHOLD`, increase `KELLY_FRACTION` slightly
- **If strong overlays perform but marginals don't**: raise the marginal threshold in `OVERLAY_TIERS`
- **If back-to-back adjustments are too aggressive**: tune the multipliers in `model.py`

---

## Part 6: The Philosophy

### Alan's Core Principles (Applied to This System)

1. **The system doesn't need to find winners — it needs to find mispriced odds.** A horse (or player prop) at 3/1 that should be 2/1 is a bad bet even if it wins. A horse at 10/1 that should be 6/1 is a good bet even if it loses.

2. **Patience is the edge.** Don't bet when there are no overlays. Some nights the system will find nothing. That's fine. Alan only bet when the numbers said to.

3. **The feedback loop is everything.** After every batch of results, replay them through the model. Are the calibration buckets accurate? If not, adjust. With each bet the computer gets smarter.

4. **Fractional Kelly protects you from ruin.** Full Kelly is theoretically optimal but practically dangerous. Quarter-Kelly cuts your growth rate but makes large drawdowns extremely unlikely.

5. **Persistence through the losing period.** The model will have losing streaks. The question is whether those losses fall within the expected variance of a model with genuine edge, or whether the model has no edge. The calibration report tells you which.

---

## Part 7: File Structure

```
woods_system/
├── config.py              # All settings in one place
├── data_pipeline.py       # NBA stats + odds ingestion
├── model.py               # Probability prediction engine
├── overlay_finder.py      # Overlay detection (model vs market)
├── kelly.py               # Kelly Criterion bet sizing
├── tracker.py             # Performance tracking + calibration
├── auto_bettor.py         # Automated bet placement
├── notifications.py       # Telegram + email alerts
├── main.py                # CLI orchestrator
├── requirements.txt       # Python dependencies
├── WOODS_SYSTEM_GUIDE.md  # This file
└── data/                  # Created at runtime
    ├── bets_log.csv       # Bet history
    ├── performance.csv    # Performance data
    └── model_cache.pkl    # Cached model state
```

---

## Part 8: Next Steps for Cloud Deployment

To make this fully automated and cloud-hosted:

1. **Dockerfile** — containerise the system
2. **Scheduler** — cron job that runs `scan → bet → execute` before each night's games
3. **Dashboard** — web UI showing overlays, bet card, P&L charts, calibration
4. **Auto-betting** — wire up Betfair (or US exchange) API for programmatic execution
5. **Results scraper** — automatically pull actual stat lines after games and settle bets
6. **Deploy** — Railway, AWS Lambda + EventBridge, or a $5/month VPS with cron

---

*"We searched for what we called overlays — any horse that had been under-bet by the public and whose odds were inflated as a result."*

*— Alan Woods, 1945–2008*
