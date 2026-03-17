"""
Woods System — NBA Sport Adapter

Wraps existing NBA model, data pipeline, and live monitor logic
into the SportAdapter interface.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from .base import SportAdapter
from data_pipeline import PlayerStatsEngine
from model import PropModel


class NBAAdapter(SportAdapter):
    """NBA adapter using nba_api for stats and live data."""

    sport_key = "basketball_nba"
    display_name = "NBA"
    prop_markets = [
        "player_points",
        "player_rebounds",
        "player_assists",
        "player_threes",
        "player_steals",
        "player_blocks",
        "player_turnovers",
    ]

    STAT_MAP = {
        "player_points": "PTS",
        "player_rebounds": "REB",
        "player_assists": "AST",
        "player_threes": "FG3M",
        "player_steals": "STL",
        "player_blocks": "BLK",
        "player_turnovers": "TOV",
    }

    def __init__(self):
        self.stats_engine = PlayerStatsEngine()
        self.model = PropModel()

    @property
    def market_to_stat(self) -> dict[str, str]:
        return {
            "player_points": "pts",
            "player_rebounds": "reb",
            "player_assists": "ast",
            "player_threes": "fg3m",
            "player_steals": "stl",
            "player_blocks": "blk",
            "player_turnovers": "tov",
        }

    def get_player_stats(self, player_name: str) -> dict | None:
        player_id = self.stats_engine.get_player_id(player_name)
        if player_id is None:
            return None
        return self.stats_engine.compute_player_profile(player_id)

    def predict_over_probability(
        self,
        player_name: str,
        market: str,
        line: float,
        **context,
    ) -> dict | None:
        return self.model.predict_over_probability(
            player_name=player_name,
            market=market,
            line=line,
            is_home=context.get("is_home", True),
            rest_days=context.get("rest_days", 2),
            opponent=context.get("opponent"),
        )

    def get_live_scoreboard(self) -> list[dict]:
        return self.stats_engine.get_live_scoreboard()

    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        return self.stats_engine.get_player_box_score(game_id, player_name)

    def get_player_jersey_number(self, player_name: str) -> str | None:
        player_id = self.stats_engine.get_player_id(player_name)
        if player_id is None:
            return None
        return self.stats_engine.get_player_jersey_number(player_id)

    def get_game_hours(self) -> tuple[int, int]:
        # NBA: 6 PM – 1 AM ET
        return (18, 25)

    def get_scan_time(self) -> str:
        return "17:00"
