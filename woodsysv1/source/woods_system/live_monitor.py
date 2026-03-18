"""
Woods System — Live Game Monitor
Polls NBA API for live game data, updates bets with real-time stats,
and auto-settles bets when games finish.

Runs every 2 minutes during game hours (6 PM – 1 AM ET).
"""

import os
import sys
import logging
from datetime import datetime

import numpy as np
from scipy import stats as scipy_stats

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_pipeline import PlayerStatsEngine
from database import Database
import config

log = logging.getLogger("woods.live")

# Map market names to stat keys used in box scores
MARKET_TO_STAT = {
    "player_points": "pts",
    "player_rebounds": "reb",
    "player_assists": "ast",
    "player_threes": "fg3m",
}


class LiveMonitor:
    """
    Monitors live NBA games to update pending bets with:
    - Game status (quarter, clock, score)
    - Live player stats
    - Updated model probability based on in-game performance
    - Auto-settlement when games finish
    """

    def __init__(self):
        self.db = Database()
        self.stats_engine = PlayerStatsEngine()

    def run_live_update(self):
        """Main entry point: check all pending bets against live games."""
        pending = self.db.get_pending_bets()
        if not pending:
            log.info("No pending bets to monitor.")
            return

        log.info(f"Monitoring {len(pending)} pending bets...")

        # Get live scoreboard
        scoreboard = self.stats_engine.get_live_scoreboard()
        if not scoreboard:
            log.info("No games on scoreboard today.")
            return

        log.info(f"Found {len(scoreboard)} games on today's scoreboard.")

        for bet in pending:
            game = self._match_bet_to_game(bet, scoreboard)
            if not game:
                continue

            if game["game_status"] == "FINAL":
                self._auto_settle(bet, game)
            elif game["game_status"].startswith("LIVE_"):
                self._update_live(bet, game)
            elif game["game_status"] == "SCHEDULED":
                # Update game_status if it changed
                if bet.get("game_status") != "SCHEDULED":
                    self.db.update_live_data(bet["id"], {"game_status": "SCHEDULED"})

    def _match_bet_to_game(self, bet: dict, scoreboard: list[dict]) -> dict | None:
        """Match a bet to a game on today's scoreboard by team names."""
        bet_home = (bet.get("home_team") or "").lower()
        bet_away = (bet.get("away_team") or "").lower()

        if not bet_home and not bet_away:
            # Old bets without team info — try to match by player
            return None

        for game in scoreboard:
            game_home = game.get("home_team", "").lower()
            game_away = game.get("away_team", "").lower()

            # Match by team name substring (handles "Mavericks" vs "Dallas Mavericks")
            if ((bet_home and (bet_home in game_home or game_home in bet_home)) or
                (bet_away and (bet_away in game_away or game_away in bet_away))):
                return game

        return None

    def _update_live(self, bet: dict, game: dict):
        """Update a bet with live game data."""
        updates = {
            "game_status": game["game_status"],
            "game_clock": game["game_clock"],
            "home_score": game["home_score"],
            "away_score": game["away_score"],
        }

        # Try to get live player stats
        stat_key = MARKET_TO_STAT.get(bet.get("market"))
        if stat_key and game.get("game_id"):
            box = self.stats_engine.get_player_box_score(game["game_id"], bet["player"])
            if box:
                live_stat = box.get(stat_key, 0)
                updates["live_stat"] = live_stat

                # Calculate updated model probability
                live_prob = self._calculate_live_prob(bet, live_stat, game)
                if live_prob is not None:
                    updates["live_model_prob"] = round(live_prob, 4)

        self.db.update_live_data(bet["id"], updates)
        log.info(f"  Updated bet {bet['id']}: {bet['player']} — {game['game_status']} "
                 f"{game.get('game_clock', '')}")

    def _calculate_live_prob(self, bet: dict, live_stat: float, game: dict) -> float | None:
        """
        Re-estimate win probability given in-game stat accumulation.

        Uses pace-adjusted projection:
        1. Calculate current stat rate (per minute)
        2. Project final stat based on expected remaining minutes
        3. Use distribution model with reduced variance
        """
        try:
            line = float(bet["line"])
            side = bet["side"]

            # Estimate minutes played and remaining
            period = game.get("game_status", "")
            if "Q1" in period:
                minutes_elapsed = 12
            elif "Q2" in period:
                minutes_elapsed = 24
            elif "HALFTIME" in period:
                minutes_elapsed = 24
            elif "Q3" in period:
                minutes_elapsed = 36
            elif "Q4" in period:
                minutes_elapsed = 44
            elif "OT" in period:
                minutes_elapsed = 53
            else:
                return None

            total_minutes = 48  # regulation
            minutes_remaining = max(total_minutes - minutes_elapsed, 1)

            if minutes_elapsed < 6:
                return None  # Too early for meaningful projection

            # Project final stat using current pace
            rate = live_stat / max(minutes_elapsed, 1)
            projected_final = live_stat + (rate * minutes_remaining)

            # Variance decreases as game progresses
            # Use original model std, scaled by remaining fraction
            stat_key = MARKET_TO_STAT.get(bet.get("market"), "pts").upper()
            base_std_map = {"PTS": 7.5, "REB": 3.2, "AST": 2.8, "FG3M": 1.5}
            base_std = base_std_map.get(stat_key, 4.0)
            remaining_fraction = minutes_remaining / total_minutes
            adjusted_std = base_std * np.sqrt(remaining_fraction)
            adjusted_std = max(adjusted_std, 0.5)  # Floor

            # P(stat > line) using projected mean and reduced variance
            z_score = (line + 0.5 - projected_final) / adjusted_std
            prob_over = 1 - scipy_stats.norm.cdf(z_score)
            prob_over = float(np.clip(prob_over, 0.01, 0.99))

            return prob_over if side == "Over" else (1 - prob_over)

        except Exception as e:
            log.warning(f"Error calculating live prob: {e}")
            return None

    def _auto_settle(self, bet: dict, game: dict):
        """Auto-settle a bet when the game has finished."""
        stat_key = MARKET_TO_STAT.get(bet.get("market"))
        if not stat_key or not game.get("game_id"):
            return

        box = self.stats_engine.get_player_box_score(game["game_id"], bet["player"])
        if not box:
            log.warning(f"  Could not get box score for {bet['player']} — skipping settlement")
            return

        actual_stat = box.get(stat_key, 0)

        # Also update final game state
        self.db.update_live_data(bet["id"], {
            "game_status": "FINAL",
            "game_clock": "Final",
            "home_score": game["home_score"],
            "away_score": game["away_score"],
            "live_stat": actual_stat,
        })

        result = self.db.settle_bet(bet["id"], actual_stat)
        if result:
            log.info(f"  SETTLED bet {bet['id']}: {bet['player']} — "
                     f"{result['result']} (actual: {actual_stat}, P&L: ${result['pnl']:+.2f})")
        else:
            log.warning(f"  Failed to settle bet {bet['id']}")


def run_live_monitor():
    """Run a single live monitor update cycle."""
    monitor = LiveMonitor()
    monitor.run_live_update()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    print("=== Woods System — Live Monitor ===")
    run_live_monitor()
