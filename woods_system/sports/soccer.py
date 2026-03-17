"""
Woods System — Soccer (EPL / Champions League) Sport Adapter

Uses football-data.org API for historical player stats and
The Odds API for pre-game player props.

Note: Soccer player prop coverage is more limited than NBA.
The adapter gracefully handles missing data.
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

log = logging.getLogger("woods.soccer")

# football-data.org free tier: 10 requests/minute
FOOTBALL_DATA_BASE = "https://api.football-data.org/v4"
RATE_LIMIT_SECONDS = 6.5  # Stay under 10 req/min


class SoccerAdapter(SportAdapter):
    """EPL / Champions League adapter using football-data.org."""

    sport_key = "soccer_epl"
    display_name = "EPL"
    prop_markets = [
        "player_goals",
        "player_shots_on_target",
        "player_soccer_assists",
        "player_tackles",
        "player_passes",
    ]

    def __init__(self, sport_key: str = "soccer_epl"):
        self.sport_key = sport_key
        if "champions" in sport_key:
            self.display_name = "UCL"
        self.api_key = os.environ.get("FOOTBALL_DATA_API_KEY", "")
        self._last_request_time = 0
        self._player_cache: dict[str, dict] = {}

    @property
    def market_to_stat(self) -> dict[str, str]:
        return {
            "player_goals": "goals",
            "player_shots_on_target": "shots_on_target",
            "player_soccer_assists": "assists",
            "player_tackles": "tackles",
            "player_passes": "passes",
        }

    def _rate_limit(self):
        elapsed = time.time() - self._last_request_time
        if elapsed < RATE_LIMIT_SECONDS:
            time.sleep(RATE_LIMIT_SECONDS - elapsed)
        self._last_request_time = time.time()

    def _api_get(self, endpoint: str) -> dict | None:
        if not self.api_key:
            log.warning("FOOTBALL_DATA_API_KEY not set — soccer stats unavailable")
            return None

        self._rate_limit()
        try:
            resp = requests.get(
                f"{FOOTBALL_DATA_BASE}{endpoint}",
                headers={"X-Auth-Token": self.api_key},
                timeout=15,
            )
            if resp.status_code == 200:
                return resp.json()
            log.warning(f"football-data.org {resp.status_code}: {endpoint}")
            return None
        except Exception as e:
            log.warning(f"football-data.org error: {e}")
            return None

    def _get_competition_id(self) -> str:
        """Map sport_key to football-data.org competition code."""
        if "champions" in self.sport_key:
            return "CL"
        return "PL"  # Premier League

    def get_player_stats(self, player_name: str) -> dict | None:
        """Get season stats for a player via football-data.org scorers endpoint."""
        if player_name in self._player_cache:
            return self._player_cache[player_name]

        comp = self._get_competition_id()
        data = self._api_get(f"/competitions/{comp}/scorers?limit=100")
        if not data or "scorers" not in data:
            return None

        name_lower = player_name.lower()
        for scorer in data["scorers"]:
            player = scorer.get("player", {})
            full_name = player.get("name", "").lower()
            if name_lower in full_name or full_name in name_lower:
                profile = {
                    "player_name": player.get("name"),
                    "team": scorer.get("team", {}).get("name"),
                    "goals": scorer.get("goals", 0),
                    "assists": scorer.get("assists", 0),
                    "matches_played": scorer.get("playedMatches", 0),
                    "goals_per_match": scorer.get("goals", 0) / max(scorer.get("playedMatches", 1), 1),
                    "assists_per_match": scorer.get("assists", 0) / max(scorer.get("playedMatches", 1), 1),
                    "shirt_number": player.get("shirtNumber"),
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
        Soccer prediction model.
        Goals and assists: Poisson distribution.
        Shots on target: negative binomial / Poisson.
        """
        stats = self.get_player_stats(player_name)

        # Use reasonable defaults if no stats found
        if stats:
            matches = stats.get("matches_played", 10)
        else:
            matches = 0

        stat_key = self.market_to_stat.get(market)
        if not stat_key:
            return None

        # Estimate mean rate per match
        if stats:
            if stat_key == "goals":
                mean_rate = stats.get("goals_per_match", 0.3)
            elif stat_key == "assists":
                mean_rate = stats.get("assists_per_match", 0.2)
            elif stat_key == "shots_on_target":
                # Approximate: top strikers ~1.5-2.0 SOT per match
                mean_rate = stats.get("goals_per_match", 0.3) * 3.5
            elif stat_key == "tackles":
                mean_rate = 2.5  # Midfielders/defenders average ~2-3 tackles/match
            elif stat_key == "passes":
                mean_rate = 45.0  # Average ~40-55 passes/match
            else:
                mean_rate = 0.3
        else:
            # Fallback defaults for unknown players
            defaults = {"goals": 0.3, "assists": 0.2, "shots_on_target": 1.2,
                        "tackles": 2.5, "passes": 45.0}
            mean_rate = defaults.get(stat_key, 0.3)

        # Home/away adjustment
        is_home = context.get("is_home", True)
        if is_home:
            mean_rate *= 1.10  # ~10% home advantage in soccer
        else:
            mean_rate *= 0.92

        # Model selection by stat type
        if stat_key == "passes":
            # Gaussian for high-volume stats
            std = mean_rate * 0.25  # ~25% CV for passes
            z_score = (line + 0.5 - mean_rate) / std
            prob_over = 1 - scipy_stats.norm.cdf(z_score)
        elif stat_key in ("goals", "assists", "shots_on_target", "tackles"):
            # Poisson for discrete, low-to-moderate count events
            prob_over = 1 - scipy_stats.poisson.cdf(int(line), mean_rate)
        else:
            prob_over = 1 - scipy_stats.poisson.cdf(int(line), mean_rate)

        prob_over = float(np.clip(prob_over, 0.02, 0.98))

        confidence = min(matches / 30, 1.0) * 0.7 if matches > 0 else 0.3

        return {
            "player": player_name,
            "market": market,
            "stat": stat_key,
            "line": line,
            "model_prob_over": round(prob_over, 4),
            "model_prob_under": round(1 - prob_over, 4),
            "expected_value": round(mean_rate, 2),
            "base_mean": round(mean_rate, 2),
            "std_dev": round(np.sqrt(mean_rate), 2),
            "confidence": round(confidence, 3),
            "games_sampled": matches,
            "adjustments": {"home" if is_home else "away": round(mean_rate * (0.10 if is_home else -0.08), 2)},
        }

    def get_live_scoreboard(self) -> list[dict]:
        """Get today's matches from football-data.org."""
        today = datetime.now().strftime("%Y-%m-%d")
        data = self._api_get(f"/matches?date={today}")
        if not data or "matches" not in data:
            return []

        comp = self._get_competition_id()
        games = []
        for match in data["matches"]:
            if match.get("competition", {}).get("code") != comp:
                continue

            status_map = {
                "SCHEDULED": "SCHEDULED",
                "TIMED": "SCHEDULED",
                "IN_PLAY": "LIVE_2H",
                "PAUSED": "LIVE_HT",
                "FINISHED": "FINAL",
                "HALFTIME": "LIVE_HT",
            }
            raw_status = match.get("status", "SCHEDULED")
            game_status = status_map.get(raw_status, "SCHEDULED")

            # Determine half from matchday minute if available
            minute = match.get("minute")
            if raw_status == "IN_PLAY" and minute:
                if minute <= 45:
                    game_status = "LIVE_1H"
                else:
                    game_status = "LIVE_2H"

            home = match.get("homeTeam", {})
            away = match.get("awayTeam", {})
            score = match.get("score", {}).get("fullTime", {})

            games.append({
                "game_id": str(match.get("id", "")),
                "game_status": game_status,
                "game_clock": f"{minute}'" if minute else None,
                "home_team": home.get("shortName", home.get("name", "")),
                "away_team": away.get("shortName", away.get("name", "")),
                "home_score": score.get("home"),
                "away_score": score.get("away"),
            })

        return games

    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        """
        Get player stats from a specific match.
        Note: football-data.org free tier may not have detailed player stats per match.
        Returns what's available.
        """
        # The free tier of football-data.org doesn't provide per-match player stats
        # We'd need a premium tier or alternative API for this
        # For now, return None and rely on post-game settlement via scorers endpoint
        log.debug(f"Per-match player stats not available on free tier for game {game_id}")
        return None

    def get_player_jersey_number(self, player_name: str) -> str | None:
        stats = self.get_player_stats(player_name)
        if stats and stats.get("shirt_number"):
            return str(stats["shirt_number"])
        return None

    def get_game_hours(self) -> tuple[int, int]:
        # EPL/CL: 7 AM – 5 PM ET (European afternoon/evening)
        return (7, 17)

    def get_scan_time(self) -> str:
        return "06:00"
