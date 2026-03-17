"""
Woods System — Abstract Sport Adapter

Each sport implements this interface so the pipeline can run
sport-agnostic scan → predict → overlay → bet logic.
"""

from abc import ABC, abstractmethod


class SportAdapter(ABC):
    """Base class for sport-specific adapters."""

    sport_key: str = ""
    display_name: str = ""
    prop_markets: list[str] = []

    @abstractmethod
    def get_player_stats(self, player_name: str) -> dict | None:
        """Get historical stats for a player. Returns profile dict or None."""

    @abstractmethod
    def predict_over_probability(
        self,
        player_name: str,
        market: str,
        line: float,
        **context,
    ) -> dict | None:
        """
        Estimate P(player goes over line) for a given market.
        Returns dict with model_prob_over, model_prob_under, expected_value, etc.
        """

    @abstractmethod
    def get_live_scoreboard(self) -> list[dict]:
        """
        Get today's live game statuses.
        Returns list of dicts with: game_id, game_status, game_clock,
        home_team, away_team, home_score, away_score.
        """

    @abstractmethod
    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        """Get live/final stats for a player in a specific game."""

    @abstractmethod
    def get_player_jersey_number(self, player_name: str) -> str | None:
        """Look up a player's jersey/shirt number."""

    def get_game_hours(self) -> tuple[int, int]:
        """
        Return (start_hour, end_hour) in local time for when games run.
        Used to schedule live monitor polling.
        Default: 18-25 (6 PM to 1 AM next day).
        """
        return (18, 25)

    def get_scan_time(self) -> str:
        """Return the daily scan time (HH:MM format). Default: 17:00."""
        return "17:00"

    def get_stat_key_for_market(self, market: str) -> str | None:
        """Map a prop market name to the stat key used in box scores."""
        return self.market_to_stat.get(market)

    @property
    def market_to_stat(self) -> dict[str, str]:
        """Override in subclasses to map market -> box score stat key."""
        return {}
