"""
Woods System — AFL (Australian Rules Football) Sport Adapter

Uses Squiggle API (https://api.squiggle.com.au) for player and match data.
AFL season runs March – September.
Free API, no key required, rate limit 1 request/second.
"""

import os
import sys
import time
import logging
import requests
from datetime import datetime

import numpy as np
from scipy import stats as scipy_stats

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from .base import SportAdapter

log = logging.getLogger("woods.afl")

SQUIGGLE_BASE = "https://api.squiggle.com.au"
RATE_LIMIT_SECONDS = 1.2  # Stay under 1 req/sec


class AFLAdapter(SportAdapter):
    """AFL adapter using Squiggle API for stats."""

    sport_key = "aussierules_afl"
    display_name = "AFL"
    prop_markets = [
        "player_disposals",
        "player_goals",
        "player_marks",
        "player_tackles",
    ]

    STAT_MAP = {
        "player_disposals": "disposals",
        "player_goals": "goals",
        "player_marks": "marks",
        "player_tackles": "tackles",
    }

    def __init__(self):
        self._player_cache: dict[str, dict] = {}
        self._player_data_loaded = False
        self._all_player_stats: list[dict] = []
        self._last_request_time = 0
        self._current_year = datetime.now().year

    @property
    def market_to_stat(self) -> dict[str, str]:
        return {
            "player_disposals": "disposals",
            "player_goals": "goals",
            "player_marks": "marks",
            "player_tackles": "tackles",
        }

    def _is_in_season(self) -> bool:
        """AFL season runs March – September."""
        month = datetime.now().month
        return 3 <= month <= 9

    def _rate_limit(self):
        """Enforce Squiggle rate limit."""
        elapsed = time.time() - self._last_request_time
        if elapsed < RATE_LIMIT_SECONDS:
            time.sleep(RATE_LIMIT_SECONDS - elapsed)
        self._last_request_time = time.time()

    def _api_get(self, params: str) -> dict | None:
        """Make a request to Squiggle API."""
        self._rate_limit()
        try:
            resp = requests.get(
                f"{SQUIGGLE_BASE}/?{params}",
                headers={"User-Agent": "WoodsSystem/2.0 (betting-model)"},
                timeout=15,
            )
            if resp.status_code == 200:
                return resp.json()
            log.warning(f"Squiggle API {resp.status_code}: {params}")
            return None
        except Exception as e:
            log.warning(f"Squiggle API error: {e}")
            return None

    def _load_player_data(self):
        """Load player stats for current season from Squiggle."""
        if self._player_data_loaded:
            return

        if not self._is_in_season():
            log.info("AFL: Offseason — no player data available")
            self._player_data_loaded = True
            return

        try:
            # Squiggle provides player stats aggregated by season
            data = self._api_get(f"q=players;year={self._current_year}")
            if data and "players" in data:
                self._all_player_stats = data["players"]
                log.info(f"Loaded {len(self._all_player_stats)} AFL player records")
            else:
                log.warning("AFL: Could not load player data from Squiggle")
                self._all_player_stats = []

            self._player_data_loaded = True
        except Exception as e:
            log.warning(f"Error loading AFL player data: {e}")
            self._player_data_loaded = True

    def get_player_stats(self, player_name: str) -> dict | None:
        """Get season stats for an AFL player."""
        if player_name in self._player_cache:
            return self._player_cache[player_name]

        if not self._is_in_season():
            return None

        self._load_player_data()

        if not self._all_player_stats:
            return None

        name_lower = player_name.lower()

        # Search through player data
        for player in self._all_player_stats:
            p_name = (player.get("firstname", "") + " " + player.get("surname", "")).strip()
            if not p_name:
                p_name = player.get("player", "")

            if name_lower == p_name.lower() or name_lower in p_name.lower():
                games = player.get("games", 0) or 0

                if games == 0:
                    continue

                profile = {
                    "player_name": p_name,
                    "team": player.get("team", ""),
                    "games_played": games,
                    "disposals_mean": (player.get("disposals", 0) or 0) / max(games, 1),
                    "disposals_std": max((player.get("disposals", 0) or 0) / max(games, 1) * 0.25, 3.0),
                    "goals_mean": (player.get("goals", 0) or 0) / max(games, 1),
                    "marks_mean": (player.get("marks", 0) or 0) / max(games, 1),
                    "marks_std": max((player.get("marks", 0) or 0) / max(games, 1) * 0.30, 1.5),
                    "tackles_mean": (player.get("tackles", 0) or 0) / max(games, 1),
                    "jersey_number": player.get("jumper"),
                }

                self._player_cache[player_name] = profile
                return profile

        return None

    def predict_over_probability(
        self,
        player_name: str,
        market: str,
        line: float,
        **context,
    ) -> dict | None:
        """
        AFL prediction model.
        Disposals/marks: Gaussian (high volume stats).
        Goals/tackles: Poisson (discrete, low-moderate count).
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
                "disposals": (22, 6),
                "goals": (1.2, 1.0),
                "marks": (5.0, 2.0),
                "tackles": (4.5, 2.0),
            }
            mean, std = defaults.get(stat_key, (5, 2))
            games = 0

        # Ensure reasonable std
        std = max(std, mean * 0.15, 1.0)

        # Home/away adjustment (AFL ~58% home win rate)
        is_home = context.get("is_home", True)
        if is_home:
            mean *= 1.08
        else:
            mean *= 0.93

        # Model selection based on stat type
        if stat_key in ("goals", "tackles"):
            # Poisson for low-count discrete events
            prob_over = 1 - scipy_stats.poisson.cdf(int(line), mean)
        else:
            # Gaussian for high-volume stats (disposals, marks)
            z_score = (line + 0.5 - mean) / std
            prob_over = 1 - scipy_stats.norm.cdf(z_score)

        prob_over = float(np.clip(prob_over, 0.02, 0.98))

        confidence = min(games / 15, 1.0) * 0.7 if games > 0 else 0.3

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
            "adjustments": {"home" if is_home else "away": round(mean * (0.08 if is_home else -0.07), 2)},
        }

    def get_live_scoreboard(self) -> list[dict]:
        """Get live AFL game scores from Squiggle."""
        if not self._is_in_season():
            return []

        data = self._api_get(f"q=games;year={self._current_year};complete=0")
        if not data or "games" not in data:
            return []

        games = []
        for match in data["games"]:
            # Determine game status
            is_complete = match.get("complete", 0) == 100
            is_live = 0 < match.get("complete", 0) < 100

            if is_complete:
                game_status = "FINAL"
            elif is_live:
                pct = match.get("complete", 0)
                if pct <= 25:
                    game_status = "LIVE_Q1"
                elif pct <= 50:
                    game_status = "LIVE_Q2"
                elif pct <= 75:
                    game_status = "LIVE_Q3"
                else:
                    game_status = "LIVE_Q4"
            else:
                game_status = "SCHEDULED"

            games.append({
                "game_id": str(match.get("id", "")),
                "game_status": game_status,
                "game_clock": f"Q{int(match.get('complete', 0) / 25) + 1}" if is_live else None,
                "home_team": match.get("hteam", ""),
                "away_team": match.get("ateam", ""),
                "home_score": match.get("hscore"),
                "away_score": match.get("ascore"),
            })

        return games

    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        """AFL per-match player stats not available via free Squiggle API."""
        return None

    def get_player_jersey_number(self, player_name: str) -> str | None:
        """Get jersey number from cached player data."""
        stats = self.get_player_stats(player_name)
        if stats and stats.get("jersey_number"):
            return str(stats["jersey_number"])
        return None

    def get_game_hours(self) -> tuple[int, int]:
        # AFL: games typically 12 PM – 10 PM AEST
        # Converting to ET: roughly 10 PM – 8 AM ET (overnight)
        # For Australian users: use local hours
        return (12, 22)

    def get_scan_time(self) -> str:
        # Scan before afternoon games (AEST)
        return "10:00"
