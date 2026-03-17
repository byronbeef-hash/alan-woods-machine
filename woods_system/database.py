"""
Woods System — Supabase Database Layer

Replaces CSV file storage with Supabase for cloud-persistent data.
Falls back to CSV if Supabase isn't configured (local dev mode).

Tables:
- bets: All bet records (pending and settled)
- performance_snapshots: Daily performance summaries
"""

import os
import json
from datetime import datetime
from typing import Optional

try:
    from supabase import create_client, Client
    SUPABASE_AVAILABLE = True
except ImportError:
    SUPABASE_AVAILABLE = False


class Database:
    """
    Supabase-backed storage for the Woods System.
    Falls back gracefully to CSV if not configured.
    """

    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL", "")
        self.key = os.environ.get("SUPABASE_KEY", "")
        self.client: Optional[Client] = None

        if SUPABASE_AVAILABLE and self.url and self.key:
            try:
                self.client = create_client(self.url, self.key)
                self.enabled = True
            except Exception as e:
                print(f"  [Supabase] Connection failed: {e}")
                self.enabled = False
        else:
            self.enabled = False
            if not SUPABASE_AVAILABLE:
                print("  [Supabase] Not installed. Run: pip install supabase")
            elif not self.url:
                print("  [Supabase] Not configured. Set SUPABASE_URL and SUPABASE_KEY.")

    def record_bet(self, bet: dict, bankroll: float) -> dict:
        """Insert a new bet record."""
        record = {
            "player": bet["player"],
            "market": bet["market"],
            "stat": bet["market"].replace("player_", "").upper(),
            "side": bet["side"],
            "line": bet["line"],
            "odds_american": bet["odds_american"],
            "odds_decimal": bet["odds_decimal"],
            "model_prob": bet["model_prob"],
            "market_implied": bet.get("market_implied", None),
            "edge": bet["edge"],
            "tier": bet["tier"],
            "bet_size": bet["bet_size"],
            "bankroll_at_bet": bankroll,
            "home_team": bet.get("home_team"),
            "away_team": bet.get("away_team"),
            "game_time": bet.get("game_time"),
            "result": "PENDING",
            "actual_stat": None,
            "pnl": None,
            "running_bankroll": None,
        }

        if not self.enabled:
            return record

        try:
            result = self.client.table("bets").insert(record).execute()
            if result.data:
                record["id"] = result.data[0]["id"]
            return record
        except Exception as e:
            print(f"  [Supabase] Error recording bet: {e}")
            return record

    def record_result(
        self, player: str, market: str, line: float, actual_stat: float
    ) -> Optional[dict]:
        """Settle a pending bet with the actual result."""
        if not self.enabled:
            return None

        try:
            # Find matching pending bet
            result = (
                self.client.table("bets")
                .select("*")
                .eq("player", player)
                .eq("market", market)
                .eq("line", line)
                .eq("result", "PENDING")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )

            if not result.data:
                return None

            row = result.data[0]
            side = row["side"]
            bet_size = float(row["bet_size"])
            odds_decimal = float(row["odds_decimal"])
            bankroll_at_bet = float(row["bankroll_at_bet"])

            won = (actual_stat > line) if side == "Over" else (actual_stat < line)
            pnl = bet_size * (odds_decimal - 1) if won else -bet_size
            running_bankroll = bankroll_at_bet + pnl

            # Update the record
            self.client.table("bets").update({
                "result": "WIN" if won else "LOSS",
                "actual_stat": actual_stat,
                "pnl": round(pnl, 2),
                "running_bankroll": round(running_bankroll, 2),
            }).eq("id", row["id"]).execute()

            return {
                "result": "WIN" if won else "LOSS",
                "actual_stat": actual_stat,
                "pnl": round(pnl, 2),
                "running_bankroll": round(running_bankroll, 2),
            }

        except Exception as e:
            print(f"  [Supabase] Error recording result: {e}")
            return None

    def get_settled_bets(self) -> list[dict]:
        """Fetch all settled bets for performance reporting."""
        if not self.enabled:
            return []

        try:
            result = (
                self.client.table("bets")
                .select("*")
                .in_("result", ["WIN", "LOSS"])
                .order("created_at")
                .execute()
            )
            return result.data or []
        except Exception as e:
            print(f"  [Supabase] Error fetching bets: {e}")
            return []

    def get_pending_bets(self) -> list[dict]:
        """Fetch all pending bets."""
        if not self.enabled:
            return []

        try:
            result = (
                self.client.table("bets")
                .select("*")
                .eq("result", "PENDING")
                .order("created_at")
                .execute()
            )
            return result.data or []
        except Exception as e:
            print(f"  [Supabase] Error fetching pending bets: {e}")
            return []

    def save_performance_snapshot(self, metrics: dict):
        """Save a daily performance snapshot."""
        if not self.enabled:
            return

        try:
            self.client.table("performance_snapshots").insert({
                "date": datetime.now().date().isoformat(),
                "total_bets": metrics.get("total_bets", 0),
                "win_rate": metrics.get("win_rate", 0),
                "total_pnl": metrics.get("total_pnl", 0),
                "roi": metrics.get("roi", 0),
                "bankroll": metrics.get("bankroll", 0),
            }).execute()
        except Exception as e:
            print(f"  [Supabase] Error saving snapshot: {e}")

    def get_current_bankroll(self) -> Optional[float]:
        """Get the most recent bankroll value."""
        if not self.enabled:
            return None

        try:
            result = (
                self.client.table("bets")
                .select("running_bankroll")
                .in_("result", ["WIN", "LOSS"])
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            if result.data and result.data[0]["running_bankroll"]:
                return float(result.data[0]["running_bankroll"])
            return None
        except Exception:
            return None
