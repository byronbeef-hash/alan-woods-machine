"""
Woods System — Configuration
Named after Alan Woods, the legendary quantitative gambler.

This config controls all system parameters: data sources, model settings,
Kelly fraction, and bankroll management.
"""

import os

# Load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# =============================================================================
# API KEYS (read from environment variables, fallback to defaults)
# =============================================================================
# Get a free key at https://the-odds-api.com (500 requests/month free)
ODDS_API_KEY = os.environ.get("ODDS_API_KEY", "YOUR_API_KEY_HERE")

# Betfair Exchange API
BETFAIR_APP_KEY = os.environ.get("BETFAIR_APP_KEY", "")
BETFAIR_USERNAME = os.environ.get("BETFAIR_USERNAME", "")
BETFAIR_PASSWORD = os.environ.get("BETFAIR_PASSWORD", "")

# Woods mode: "demo" for paper trading, "live" for real Betfair
WOODS_MODE = os.environ.get("WOODS_MODE", "demo")

# =============================================================================
# BANKROLL SETTINGS
# =============================================================================
STARTING_BANKROLL = 5000.0       # Starting paper-trade bankroll in USD
KELLY_FRACTION = 0.25            # Quarter-Kelly (conservative; Alan used 2/3)
MIN_EDGE_THRESHOLD = 0.03        # Minimum 3% edge to place a bet
MAX_BET_FRACTION = 0.10          # Hard cap: never bet more than 10% of bankroll
MAX_BET_BY_TIER = {              # Tiered caps based on edge strength
    "STRONG":   0.10,            # Up to 10% for 8%+ edge
    "MODERATE": 0.06,            # Up to 6% for 5-8% edge
    "MARGINAL": 0.03,            # Up to 3% for 3-5% edge
}
MIN_BET_SIZE = 10.0              # Minimum bet size in USD
COMMISSION_RATE = 0.05           # Betfair commission (5% on net winnings)

# =============================================================================
# MODEL SETTINGS
# =============================================================================
LOOKBACK_GAMES = 15              # Number of recent games to weight heavily
SEASON_WEIGHT = 0.3              # Weight for full-season averages
RECENT_WEIGHT = 0.7              # Weight for recent-form averages
MIN_GAMES_PLAYED = 10            # Minimum games before we model a player

# =============================================================================
# DATA SETTINGS
# =============================================================================
NBA_SEASON = "2025-26"           # Current NBA season
MAX_AUTO_BETS = 4                # Maximum bets to auto-place per scan
SPORT_KEY = "basketball_nba"     # The Odds API sport key
PROP_MARKETS = [                 # Player prop markets to scan
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
]

# =============================================================================
# OVERLAY CATEGORIES (Alan's terminology)
# =============================================================================
# Win Expectation > 1.0 = overlay (bet), < 1.0 = underlay (avoid)
# These thresholds classify the strength of overlays found
OVERLAY_TIERS = {
    "STRONG":   0.08,   # 8%+ edge — rare, bet aggressively
    "MODERATE": 0.05,   # 5-8% edge — solid overlay
    "MARGINAL": 0.03,   # 3-5% edge — minimum threshold
}

# =============================================================================
# FILE PATHS
# =============================================================================
DATA_DIR = "data"
BETS_LOG = "data/bets_log.csv"
PERFORMANCE_LOG = "data/performance.csv"
MODEL_CACHE = "data/model_cache.pkl"
