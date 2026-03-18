"""
Woods System — NFL Sport Adapter

Uses nfl_data_py for historical player stats.
NFL season runs September – February; adapter returns empty during offseason.
"""

import os
import sys
import logging
from datetime import datetime

import numpy as np
from scipy import stats as scipy_stats

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from .base import SportAdapter

log = logging.getLogger("woods.nfl")

# Try to import nfl_data_py (optional dependency)
try:
    import nfl_data_py as nfl
    NFL_DATA_AVAILABLE = True
except ImportError:
    NFL_DATA_AVAILABLE = False
    log.warning("nfl_data_py not installed. Run: pip install nfl_data_py")


class NFLAdapter(SportAdapter):
    """NFL adapter using nfl_data_py for stats."""

    sport_key = "americanfootball_nfl"
    display_name = "NFL"
    prop_markets = [
        "player_pass_yds",
        "player_rush_yds",
        "player_reception_yds",
        "player_pass_tds",
        "player_anytime_td",
    ]

    STAT_MAP = {
        "player_pass_yds": "passing_yards",
        "player_rush_yds": "rushing_yards",
        "player_reception_yds": "receiving_yards",
        "player_pass_tds": "passing_tds",
        "player_anytime_td": "total_tds",
    }

    def __init__(self):
        self._player_cache: dict[str, dict] = {}
        self._weekly_data = None
        self._current_season = self._get_current_season()

    @property
    def market_to_stat(self) -> dict[str, str]:
        return {
            "player_pass_yds": "passing_yards",
            "player_rush_yds": "rushing_yards",
            "player_reception_yds": "receiving_yards",
            "player_pass_tds": "passing_tds",
            "player_anytime_td": "total_tds",
        }

    def _get_current_season(self) -> int:
        """NFL season year (season that started in this calendar year or last year)."""
        now = datetime.now()
        return now.year if now.month >= 9 else now.year - 1

    def _is_in_season(self) -> bool:
        """Check if we're within NFL season (Sep – Feb)."""
        month = datetime.now().month
        return month >= 9 or month <= 2

    def _load_weekly_data(self):
        """Load weekly player stats from nfl_data_py."""
        if self._weekly_data is not None:
            return

        if not NFL_DATA_AVAILABLE:
            self._weekly_data = []
            return

        try:
            log.info(f"Loading NFL weekly data for {self._current_season}...")
            self._weekly_data = nfl.import_weekly_data([self._current_season])
            log.info(f"Loaded {len(self._weekly_data)} weekly stat rows")
        except Exception as e:
            log.warning(f"Error loading NFL data: {e}")
            self._weekly_data = []

    def get_player_stats(self, player_name: str) -> dict | None:
        """Get season stats for an NFL player."""
        if player_name in self._player_cache:
            return self._player_cache[player_name]

        if not NFL_DATA_AVAILABLE or not self._is_in_season():
            return None

        self._load_weekly_data()
        if self._weekly_data is None or len(self._weekly_data) == 0:
            return None

        df = self._weekly_data
        name_lower = player_name.lower()

        # Match player name
        mask = df["player_display_name"].str.lower() == name_lower
        if not mask.any():
            # Try partial match
            mask = df["player_display_name"].str.lower().str.contains(name_lower, na=False)

        if not mask.any():
            return None

        player_df = df[mask]
        games_played = len(player_df)

        profile = {
            "player_name": player_name,
            "games_played": games_played,
            "passing_yards_mean": player_df["passing_yards"].mean() if "passing_yards" in player_df else 0,
            "passing_yards_std": player_df["passing_yards"].std() if "passing_yards" in player_df else 0,
            "rushing_yards_mean": player_df["rushing_yards"].mean() if "rushing_yards" in player_df else 0,
            "rushing_yards_std": player_df["rushing_yards"].std() if "rushing_yards" in player_df else 0,
            "receiving_yards_mean": player_df["receiving_yards"].mean() if "receiving_yards" in player_df else 0,
            "receiving_yards_std": player_df["receiving_yards"].std() if "receiving_yards" in player_df else 0,
            "passing_tds_mean": player_df["passing_tds"].mean() if "passing_tds" in player_df else 0,
            "total_tds_mean": (
                player_df[["passing_tds", "rushing_tds"]].sum(axis=1).mean()
                if "passing_tds" in player_df else 0
            ),
        }

        self._player_cache[player_name] = profile
        return profile

    def predict_over_probability(
        self,
        player_name: str,
        market: str,
        line: float,
        **context,
    ) -> dict | None:
        """
        NFL prediction model.
        Passing/rushing/receiving yards: Gaussian (high volume, CLT).
        Touchdowns: Poisson (discrete, low count).
        """
        if not self._is_in_season():
            return None

        stats = self.get_player_stats(player_name)
        stat_key = self.STAT_MAP.get(market)
        if not stat_key:
            return None

        if stats and stats.get("games_played", 0) >= 3:
            mean = stats.get(f"{stat_key}_mean", 0)
            std = stats.get(f"{stat_key}_std", 0)
            games = stats["games_played"]
        else:
            # Fallback defaults for unknown players
            defaults = {
                "passing_yards": (240, 60),
                "rushing_yards": (65, 30),
                "receiving_yards": (55, 28),
                "passing_tds": (1.7, 1.0),
                "total_tds": (2.0, 1.2),
            }
            mean, std = defaults.get(stat_key, (50, 20))
            games = 0

        # Ensure reasonable std
        std = max(std, mean * 0.15, 1.0)

        # Home/away adjustment
        is_home = context.get("is_home", True)
        if is_home:
            mean *= 1.05
        else:
            mean *= 0.96

        # Model selection based on stat type
        if stat_key in ("passing_tds", "total_tds"):
            # Poisson for touchdowns
            prob_over = 1 - scipy_stats.poisson.cdf(int(line), mean)
        else:
            # Gaussian for yards
            z_score = (line + 0.5 - mean) / std
            prob_over = 1 - scipy_stats.norm.cdf(z_score)

        prob_over = float(np.clip(prob_over, 0.02, 0.98))

        confidence = min(games / 12, 1.0) * 0.7 if games > 0 else 0.3

        return {
            "player": player_name,
            "market": market,
            "stat": stat_key,
            "line": line,
            "model_prob_over": round(prob_over, 4),
            "model_prob_under": round(1 - prob_over, 4),
            "expected_value": round(mean, 2),
            "base_mean": round(mean, 2),
            "std_dev": round(std, 2),
            "confidence": round(confidence, 3),
            "games_sampled": games,
            "adjustments": {"home" if is_home else "away": round(mean * (0.05 if is_home else -0.04), 2)},
        }

    def get_live_scoreboard(self) -> list[dict]:
        """
        Get live NFL scores. nfl_data_py doesn't have real-time scores,
        so this returns empty. Live monitoring for NFL would need
        ESPN API or similar.
        """
        if not self._is_in_season():
            return []

        # TODO: integrate ESPN public API for live NFL scores
        # For now, live monitoring is NBA-only; NFL bets settle via results check
        log.debug("NFL live scoreboard not yet implemented — use results check")
        return []

    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        """NFL box scores not available in real-time on free APIs."""
        return None

    def get_player_jersey_number(self, player_name: str) -> str | None:
        """nfl_data_py roster data includes jersey numbers."""
        if not NFL_DATA_AVAILABLE:
            return None
        try:
            rosters = nfl.import_rosters([self._current_season])
            name_lower = player_name.lower()
            mask = rosters["player_name"].str.lower() == name_lower
            if mask.any():
                num = rosters[mask].iloc[0].get("jersey_number")
                return str(int(num)) if num and not np.isnan(num) else None
        except Exception as e:
            log.debug(f"Error getting NFL jersey number: {e}")
        return None

    def get_game_hours(self) -> tuple[int, int]:
        # NFL: 1 PM – 11 PM ET (Sunday + Mon/Thu nights)
        return (13, 23)

    def get_scan_time(self) -> str:
        return "11:00"
