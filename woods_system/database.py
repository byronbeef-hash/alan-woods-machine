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
import time
from datetime import datetime
from typing import Optional

import config

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
            "jersey_number": bet.get("jersey_number"),
            "commission_rate": bet.get("commission_rate", config.COMMISSION_RATE),
            "sport": bet.get("sport", config.SPORT_KEY),
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
            commission = float(row.get("commission_rate") or config.COMMISSION_RATE)
            pnl = bet_size * (odds_decimal - 1) * (1 - commission) if won else -bet_size
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

    def update_live_data(self, bet_id: int, updates: dict):
        """Update live game data fields on a bet."""
        if not self.enabled:
            return

        try:
            self.client.table("bets").update(updates).eq("id", bet_id).execute()
        except Exception as e:
            print(f"  [Supabase] Error updating live data for bet {bet_id}: {e}")

    def settle_bet(self, bet_id: int, actual_stat: float) -> Optional[dict]:
        """Settle a specific bet by ID with the final actual stat."""
        if not self.enabled:
            return None

        try:
            result = (
                self.client.table("bets")
                .select("*")
                .eq("id", bet_id)
                .eq("result", "PENDING")
                .limit(1)
                .execute()
            )

            if not result.data:
                return None

            row = result.data[0]
            side = row["side"]
            line = float(row["line"])
            bet_size = float(row["bet_size"])
            odds_decimal = float(row["odds_decimal"])
            bankroll_at_bet = float(row["bankroll_at_bet"])

            won = (actual_stat > line) if side == "Over" else (actual_stat < line)
            commission = float(row.get("commission_rate") or config.COMMISSION_RATE)
            pnl = bet_size * (odds_decimal - 1) * (1 - commission) if won else -bet_size
            running_bankroll = bankroll_at_bet + pnl

            self.client.table("bets").update({
                "result": "WIN" if won else "LOSS",
                "actual_stat": actual_stat,
                "pnl": round(pnl, 2),
                "running_bankroll": round(running_bankroll, 2),
                "game_status": "FINAL",
                "settled_at": datetime.now().isoformat(),
            }).eq("id", bet_id).execute()

            return {
                "id": bet_id,
                "result": "WIN" if won else "LOSS",
                "actual_stat": actual_stat,
                "pnl": round(pnl, 2),
                "running_bankroll": round(running_bankroll, 2),
            }

        except Exception as e:
            print(f"  [Supabase] Error settling bet {bet_id}: {e}")
            return None

    # -------------------------------------------------------------------------
    # System Config (read/write from system_config table)
    # -------------------------------------------------------------------------
    _config_cache: dict = {}
    _config_cache_time: float = 0
    _CONFIG_CACHE_TTL = 300  # 5 minutes

    def get_all_config(self) -> dict:
        """Fetch all system config as {key: value} dict. Cached for 5 min."""
        now = time.time()
        if self._config_cache and (now - self._config_cache_time) < self._CONFIG_CACHE_TTL:
            return self._config_cache

        if not self.enabled:
            return {}

        try:
            result = self.client.table("system_config").select("key, value").execute()
            cfg = {}
            for row in (result.data or []):
                val = row["value"]
                # JSONB values come back as Python types already
                if isinstance(val, str):
                    try:
                        val = json.loads(val)
                    except (json.JSONDecodeError, TypeError):
                        pass
                cfg[row["key"]] = val
            self._config_cache = cfg
            self._config_cache_time = now
            return cfg
        except Exception as e:
            print(f"  [Supabase] Error fetching config: {e}")
            return self._config_cache or {}

    def get_config(self, key: str, default=None):
        """Get a single config value by key."""
        cfg = self.get_all_config()
        return cfg.get(key, default)

    def set_config(self, key: str, value) -> bool:
        """Upsert a config value."""
        if not self.enabled:
            return False
        try:
            self.client.table("system_config").upsert({
                "key": key,
                "value": json.dumps(value) if not isinstance(value, (int, float, bool, list)) else value,
                "updated_at": datetime.now().isoformat(),
            }).execute()
            # Invalidate cache
            self._config_cache = {}
            self._config_cache_time = 0
            return True
        except Exception as e:
            print(f"  [Supabase] Error setting config {key}: {e}")
            return False

    # -------------------------------------------------------------------------
    # Scan Results (scanner page + auto-placement)
    # -------------------------------------------------------------------------

    def insert_scan_results(self, results: list[dict], scan_id: str) -> int:
        """Batch insert scan results. Returns count inserted."""
        if not self.enabled or not results:
            return 0

        records = []
        for r in results:
            records.append({
                "scan_id": scan_id,
                "sport": r.get("sport", ""),
                "player": r.get("player", ""),
                "market": r.get("market", ""),
                "stat": r.get("market", "").replace("player_", "").upper(),
                "side": r.get("side", "Over"),
                "line": r.get("line", 0),
                "odds_american": r.get("odds_american"),
                "odds_decimal": r.get("odds_decimal"),
                "model_prob": r.get("model_prob"),
                "market_implied": r.get("market_implied"),
                "edge": r.get("edge"),
                "tier": r.get("tier"),
                "confidence": r.get("confidence"),
                "kelly_pct": r.get("kelly_pct"),
                "suggested_bet_size": r.get("bet_size"),
                "home_team": r.get("home_team"),
                "away_team": r.get("away_team"),
                "game_time": r.get("game_time"),
                "status": "ACTIVE",
            })

        try:
            result = self.client.table("scan_results").insert(records).execute()
            return len(result.data) if result.data else 0
        except Exception as e:
            print(f"  [Supabase] Error inserting scan results: {e}")
            return 0

    def mark_scan_result_placed(self, scan_result_id: int, bet_id: int):
        """Mark a scan result as placed with reference to bets table."""
        if not self.enabled:
            return
        try:
            self.client.table("scan_results").update({
                "status": "PLACED",
                "placed_bet_id": bet_id,
            }).eq("id", scan_result_id).execute()
        except Exception as e:
            print(f"  [Supabase] Error marking scan result placed: {e}")

    def expire_old_scan_results(self):
        """Mark expired scan results (game already started)."""
        if not self.enabled:
            return
        try:
            self.client.table("scan_results").update({
                "status": "EXPIRED",
            }).eq("status", "ACTIVE").lt(
                "game_time", datetime.now().isoformat()
            ).execute()
        except Exception as e:
            print(f"  [Supabase] Error expiring scan results: {e}")

    def get_active_scan_results(self, sport: str = None, market: str = None) -> list[dict]:
        """Get active scan results for the dashboard."""
        if not self.enabled:
            return []
        try:
            query = (
                self.client.table("scan_results")
                .select("*")
                .in_("status", ["ACTIVE", "PLACED"])
                .order("edge", desc=True)
            )
            if sport:
                query = query.eq("sport", sport)
            if market:
                query = query.eq("market", market)
            result = query.execute()
            return result.data or []
        except Exception as e:
            print(f"  [Supabase] Error fetching scan results: {e}")
            return []

    # -------------------------------------------------------------------------
    # Manual Scan Requests (dashboard → runner communication)
    # -------------------------------------------------------------------------

    def get_manual_scan_request(self) -> Optional[dict]:
        """Read pending manual scan request from system_config."""
        if not self.enabled:
            return None
        try:
            result = (
                self.client.table("system_config")
                .select("value")
                .eq("key", "manual_scan_request")
                .limit(1)
                .execute()
            )
            if not result.data:
                return None
            val = result.data[0].get("value")
            if not val or (isinstance(val, dict) and not val.get("sport_key")):
                return None
            # Parse if string
            if isinstance(val, str):
                try:
                    val = json.loads(val)
                except (json.JSONDecodeError, TypeError):
                    return None
            return val if isinstance(val, dict) and val.get("sport_key") else None
        except Exception as e:
            print(f"  [Supabase] Error reading manual scan request: {e}")
            return None

    def clear_manual_scan_request(self) -> bool:
        """Clear the manual scan request after processing."""
        if not self.enabled:
            return False
        try:
            self.client.table("system_config").upsert({
                "key": "manual_scan_request",
                "value": None,
                "updated_at": datetime.now().isoformat(),
            }).execute()
            # Invalidate cache so next read picks up the cleared state
            self._config_cache = {}
            self._config_cache_time = 0
            return True
        except Exception as e:
            print(f"  [Supabase] Error clearing manual scan request: {e}")
            return False

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
