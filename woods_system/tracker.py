"""
Woods System — Paper Trading Tracker & Performance Analytics

This is the feedback loop that made Alan's system get smarter over time.
After each race meeting, results were played back through the model.
If they justified changing any weighting, the change became permanent.
With each race the computer got "smarter."

We track every bet (paper or real), record outcomes, and compute
the metrics that tell us whether our model has a genuine edge
or we're just getting lucky.
"""

import os
import csv
import json
import pandas as pd
import numpy as np
from datetime import datetime

import config
from database import Database


class BetTracker:
    """
    Records bets, tracks outcomes, and computes performance metrics.
    Uses Supabase when configured, falls back to CSV for local dev.
    """

    HEADERS = [
        "timestamp", "player", "market", "stat", "side", "line",
        "odds_american", "odds_decimal", "model_prob", "market_implied",
        "edge", "tier", "bet_size", "bankroll_at_bet",
        "result", "actual_stat", "pnl", "running_bankroll",
        "notes",
    ]

    def __init__(self, log_path: str = None):
        self.log_path = log_path or config.BETS_LOG
        self.db = Database()
        self._ensure_log_exists()

    def _ensure_log_exists(self):
        os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
        if not os.path.exists(self.log_path):
            with open(self.log_path, "w", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(self.HEADERS)

    def record_bet(self, bet: dict, bankroll: float) -> dict:
        """
        Record a new bet (pending outcome).
        Returns the bet record with a unique ID.
        """
        record = {
            "timestamp": datetime.now().isoformat(),
            "player": bet["player"],
            "market": bet["market"],
            "stat": bet["market"].replace("player_", "").upper(),
            "side": bet["side"],
            "line": bet["line"],
            "odds_american": bet["odds_american"],
            "odds_decimal": bet["odds_decimal"],
            "model_prob": bet["model_prob"],
            "market_implied": bet.get("market_implied", ""),
            "edge": bet["edge"],
            "tier": bet["tier"],
            "bet_size": bet["bet_size"],
            "bankroll_at_bet": bankroll,
            "result": "PENDING",
            "actual_stat": "",
            "pnl": "",
            "running_bankroll": "",
            "notes": "",
        }

        # Write to CSV (local backup)
        with open(self.log_path, "a", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=self.HEADERS)
            writer.writerow(record)

        # Write to Supabase (cloud persistent)
        if self.db.enabled:
            self.db.record_bet(bet, bankroll)

        return record

    def record_result(
        self, player: str, market: str, line: float,
        actual_stat: float, timestamp: str = None,
    ) -> dict | None:
        """
        Record the outcome of a bet.
        Returns the updated record with P&L calculated.
        """
        df = pd.read_csv(self.log_path)
        if df.empty:
            return None

        # Find matching pending bet
        mask = (
            (df["player"] == player) &
            (df["market"] == market) &
            (df["line"] == line) &
            (df["result"] == "PENDING")
        )
        if timestamp:
            mask &= df["timestamp"].str.startswith(timestamp[:10])

        matches = df[mask]
        if matches.empty:
            return None

        idx = matches.index[-1]  # Most recent matching bet
        row = df.loc[idx]

        # Determine win/loss
        side = row["side"]
        if side == "Over":
            won = actual_stat > line
        else:
            won = actual_stat < line

        # Calculate P&L
        bet_size = float(row["bet_size"])
        odds_decimal = float(row["odds_decimal"])
        if won:
            pnl = bet_size * (odds_decimal - 1)
            result = "WIN"
        else:
            pnl = -bet_size
            result = "LOSS"

        # Update running bankroll
        bankroll_at_bet = float(row["bankroll_at_bet"])
        running_bankroll = bankroll_at_bet + pnl

        # Update the record
        df.at[idx, "result"] = result
        df.at[idx, "actual_stat"] = actual_stat
        df.at[idx, "pnl"] = round(pnl, 2)
        df.at[idx, "running_bankroll"] = round(running_bankroll, 2)

        df.to_csv(self.log_path, index=False)

        # Also update in Supabase
        if self.db.enabled:
            self.db.record_result(player, market, line, actual_stat)

        return {
            "result": result,
            "actual_stat": actual_stat,
            "pnl": round(pnl, 2),
            "running_bankroll": round(running_bankroll, 2),
        }

    def get_performance_report(self) -> str:
        """
        Generate a comprehensive performance report.

        This is the equivalent of Alan replaying the race meeting
        through his model — are we actually profitable? Is the model
        calibrated? Where are the edges strongest?
        """
        if not os.path.exists(self.log_path):
            return "\n  No bets recorded yet. Start paper trading!\n"

        df = pd.read_csv(self.log_path)
        settled = df[df["result"].isin(["WIN", "LOSS"])].copy()

        if settled.empty:
            pending = len(df[df["result"] == "PENDING"])
            return f"\n  No settled bets yet. {pending} pending.\n"

        # --- Core Metrics ---
        total_bets = len(settled)
        wins = len(settled[settled["result"] == "WIN"])
        losses = len(settled[settled["result"] == "LOSS"])
        win_rate = wins / total_bets

        settled["pnl"] = settled["pnl"].astype(float)
        settled["bet_size"] = settled["bet_size"].astype(float)
        total_pnl = settled["pnl"].sum()
        total_wagered = settled["bet_size"].sum()
        roi = (total_pnl / total_wagered) * 100 if total_wagered > 0 else 0

        avg_win = settled[settled["result"] == "WIN"]["pnl"].mean() if wins > 0 else 0
        avg_loss = abs(settled[settled["result"] == "LOSS"]["pnl"].mean()) if losses > 0 else 0

        # Profit factor
        gross_wins = settled[settled["pnl"] > 0]["pnl"].sum()
        gross_losses = abs(settled[settled["pnl"] < 0]["pnl"].sum())
        profit_factor = gross_wins / gross_losses if gross_losses > 0 else float("inf")

        # --- Model Calibration ---
        # Are our predicted probabilities matching actual outcomes?
        settled["model_prob"] = settled["model_prob"].astype(float)
        calibration = self._check_calibration(settled)

        # --- By Tier ---
        tier_stats = {}
        for tier in ["STRONG", "MODERATE", "MARGINAL"]:
            tier_df = settled[settled["tier"] == tier]
            if len(tier_df) > 0:
                tier_stats[tier] = {
                    "bets": len(tier_df),
                    "win_rate": f"{(tier_df['result'] == 'WIN').mean():.1%}",
                    "pnl": f"${tier_df['pnl'].sum():,.0f}",
                    "roi": f"{(tier_df['pnl'].sum() / tier_df['bet_size'].sum()) * 100:.1f}%",
                }

        # --- Max Drawdown ---
        settled["cumulative_pnl"] = settled["pnl"].cumsum()
        settled["peak"] = settled["cumulative_pnl"].cummax()
        settled["drawdown"] = settled["cumulative_pnl"] - settled["peak"]
        max_drawdown = settled["drawdown"].min()

        # --- Format Report ---
        lines = []
        lines.append("")
        lines.append("=" * 78)
        lines.append("  PERFORMANCE REPORT — Woods System")
        lines.append("  'After each race, the computer got smarter.'")
        lines.append("=" * 78)

        lines.append("")
        lines.append("  OVERALL:")
        lines.append(f"    Total Bets:     {total_bets}  ({wins}W / {losses}L)")
        lines.append(f"    Win Rate:       {win_rate:.1%}")
        lines.append(f"    Total P&L:      ${total_pnl:,.2f}")
        lines.append(f"    Total Wagered:  ${total_wagered:,.2f}")
        lines.append(f"    ROI:            {roi:.2f}%")
        lines.append(f"    Profit Factor:  {profit_factor:.2f}x")
        lines.append(f"    Avg Win:        ${avg_win:,.2f}")
        lines.append(f"    Avg Loss:       ${avg_loss:,.2f}")
        lines.append(f"    Max Drawdown:   ${max_drawdown:,.2f}")

        if tier_stats:
            lines.append("")
            lines.append("  BY TIER:")
            for tier, stats in tier_stats.items():
                lines.append(f"    {tier:10s}  {stats['bets']} bets  |  "
                             f"Win: {stats['win_rate']}  |  "
                             f"P&L: {stats['pnl']}  |  "
                             f"ROI: {stats['roi']}")

        lines.append("")
        lines.append("  MODEL CALIBRATION:")
        for bucket, cal in calibration.items():
            lines.append(f"    Predicted {bucket}:  "
                         f"Actual {cal['actual']:.1%}  "
                         f"({cal['count']} bets)  "
                         f"{'GOOD' if cal['calibrated'] else 'NEEDS ADJUSTMENT'}")

        pending = len(df[df["result"] == "PENDING"])
        if pending > 0:
            lines.append(f"\n  PENDING: {pending} unsettled bets")

        lines.append("")
        lines.append("=" * 78)
        return "\n".join(lines)

    def _check_calibration(self, settled: pd.DataFrame) -> dict:
        """
        Check model calibration: do our 60% predictions win 60% of the time?

        This is the single most important diagnostic. If the model is
        well-calibrated, the profits will follow. If it's not, we need
        to adjust the coefficients — exactly as Alan did.
        """
        calibration = {}
        buckets = [
            ("50-60%", 0.50, 0.60),
            ("60-70%", 0.60, 0.70),
            ("70-80%", 0.70, 0.80),
            ("80%+",   0.80, 1.00),
        ]

        for label, low, high in buckets:
            mask = (settled["model_prob"] >= low) & (settled["model_prob"] < high)
            bucket_df = settled[mask]
            if len(bucket_df) >= 3:
                actual_win_rate = (bucket_df["result"] == "WIN").mean()
                midpoint = (low + high) / 2
                calibration[label] = {
                    "actual": actual_win_rate,
                    "expected": midpoint,
                    "count": len(bucket_df),
                    "calibrated": abs(actual_win_rate - midpoint) < 0.10,
                }
            else:
                calibration[label] = {
                    "actual": 0,
                    "expected": (low + high) / 2,
                    "count": len(bucket_df),
                    "calibrated": True,  # Insufficient data
                }

        return calibration


if __name__ == "__main__":
    print("=== Woods System — Tracker Test ===\n")
    tracker = BetTracker(log_path="data/test_bets.csv")

    # Simulate some bets
    test_bets = [
        {"player": "Luka Doncic", "market": "player_points", "side": "Over",
         "line": 28.5, "odds_american": -115, "odds_decimal": 1.87,
         "model_prob": 0.58, "edge": 0.05, "tier": "MODERATE", "bet_size": 100},
        {"player": "Nikola Jokic", "market": "player_rebounds", "side": "Over",
         "line": 12.5, "odds_american": -110, "odds_decimal": 1.91,
         "model_prob": 0.55, "edge": 0.03, "tier": "MARGINAL", "bet_size": 75},
    ]

    for bet in test_bets:
        tracker.record_bet(bet, bankroll=5000)

    # Record some results
    tracker.record_result("Luka Doncic", "player_points", 28.5, actual_stat=32)
    tracker.record_result("Nikola Jokic", "player_rebounds", 12.5, actual_stat=11)

    print(tracker.get_performance_report())
