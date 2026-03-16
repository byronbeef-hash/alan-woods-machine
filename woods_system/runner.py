#!/usr/bin/env python3
"""
Woods System — Automated Runner
Runs the full pipeline on a schedule: scan → bet → execute → notify.

Designed to run in a Docker container or cloud VM.
Set WOODS_MODE=demo for paper trading (default), WOODS_MODE=live for real money.

Schedule:
- 5:00 PM ET: Scan for overlays, generate bet card, auto-execute (paper)
- 11:30 PM ET: Fetch results, update tracker, send daily report
- Both times are configurable via environment variables.
"""

import os
import sys
import time
import signal
import logging
from datetime import datetime

import schedule

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_pipeline import OddsEngine, PlayerStatsEngine
from model import PropModel
from overlay_finder import OverlayFinder
from kelly import KellyBetSizer
from tracker import BetTracker
from auto_bettor import AutoBettor, DryRunExchange, BetfairExchange
from notifications import NotificationManager
import config

# ─── Configuration from environment ───────────────────────────────────────────

MODE = os.environ.get("WOODS_MODE", "demo")  # "demo" or "live"
SCAN_TIME = os.environ.get("WOODS_SCAN_TIME", "17:00")  # 5 PM ET
RESULTS_TIME = os.environ.get("WOODS_RESULTS_TIME", "23:30")  # 11:30 PM ET
LOG_LEVEL = os.environ.get("WOODS_LOG_LEVEL", "INFO")
RUN_ONCE = os.environ.get("WOODS_RUN_ONCE", "").lower() in ("1", "true", "yes")

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("woods")


# ─── Core Pipeline ────────────────────────────────────────────────────────────

def run_scan_and_bet():
    """
    Full pipeline: scan → predict → find overlays → size bets → execute.
    This runs before tip-off each night.
    """
    log.info("=" * 60)
    log.info("WOODS SYSTEM — SCAN & BET PIPELINE")
    log.info(f"Mode: {MODE.upper()} | Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    notifier = NotificationManager()

    try:
        # 1. Fetch odds
        log.info("[1/5] Fetching upcoming games and odds...")
        odds_engine = OddsEngine()
        games = odds_engine.get_upcoming_games()
        log.info(f"       Found {len(games)} games")

        # 2. Collect all props (deduplicated)
        all_props = []
        seen = set()
        for market in config.PROP_MARKETS:
            log.info(f"[2/5] Fetching {market} props...")
            for game in games:
                game_id = game.get("id", "demo")
                props = odds_engine.get_player_props(game_id, market)
                for p in props:
                    key = (p["player"], p["market"], p["side"], p["line"])
                    if key not in seen:
                        seen.add(key)
                        all_props.append(p)

        players = set(p["player"] for p in all_props if p["side"] == "Over")
        log.info(f"       {len(all_props)} prop lines across {len(players)} players")

        # 3. Run model
        log.info("[3/5] Running model predictions...")
        model = PropModel()
        predictions = model.batch_predict(all_props)
        log.info(f"       Generated {len(predictions)} predictions")

        # 4. Find overlays
        log.info("[4/5] Scanning for overlays...")
        finder = OverlayFinder()
        overlays = finder.find_overlays(predictions)
        report = finder.format_overlay_report(overlays)
        log.info(report)

        if not overlays:
            log.info("No overlays found. Patience is the edge.")
            notifier.telegram.send("📭 <b>No overlays today.</b> Patience is the edge.")
            return

        # 5. Size bets and execute
        log.info("[5/5] Sizing bets and executing...")
        tracker = BetTracker()
        sizer = KellyBetSizer()
        bets = sizer.size_all_bets(overlays)
        bet_card = sizer.format_bet_card(bets)
        log.info(bet_card)

        # Set up exchange
        if MODE == "live":
            exchange = BetfairExchange()
        else:
            exchange = DryRunExchange(starting_balance=sizer.bankroll)

        bettor = AutoBettor(exchange=exchange, notifier=notifier)
        results = bettor.execute_bet_card(bets)

        # Record bets in tracker
        for bet in bets:
            tracker.record_bet(bet, sizer.bankroll)

        log.info(f"\nPlaced {len(results)} bets ({MODE} mode)")

        # Send notifications
        notifier.notify_bet_card(bets, sizer.bankroll)

    except Exception as e:
        log.exception(f"Pipeline error: {e}")
        notifier.notify_error(f"Scan pipeline failed: {e}")


def run_results_and_report():
    """
    Post-game: fetch actual stats, settle bets, generate performance report.
    This runs after games finish each night.
    """
    log.info("=" * 60)
    log.info("WOODS SYSTEM — RESULTS & REPORT")
    log.info(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    notifier = NotificationManager()

    try:
        tracker = BetTracker()
        report = tracker.get_performance_report()
        log.info(report)

        # Send daily report
        notifier.telegram.send_daily_summary(report)
        log.info("Daily report sent.")

    except Exception as e:
        log.exception(f"Results pipeline error: {e}")
        notifier.notify_error(f"Results pipeline failed: {e}")


def run_backtest_demo():
    """
    Run the demo backtest to verify the system works end-to-end.
    Use this for initial testing before going live with paper trading.
    """
    log.info("=" * 60)
    log.info("WOODS SYSTEM — DEMO BACKTEST")
    log.info("=" * 60)

    import random
    random.seed(42)

    tracker = BetTracker(log_path="data/demo_backtest.csv")
    sizer = KellyBetSizer(bankroll=5000)

    scenarios = [
        ("Luka Doncic", "player_points", 28.5, 0.58, 0.52, 32),
        ("LeBron James", "player_points", 25.5, 0.55, 0.50, 22),
        ("Nikola Jokic", "player_rebounds", 12.5, 0.60, 0.52, 14),
        ("Jayson Tatum", "player_points", 27.5, 0.53, 0.48, 30),
        ("Anthony Edwards", "player_points", 24.5, 0.56, 0.50, 28),
        ("Shai Gilgeous-Alexander", "player_points", 31.5, 0.54, 0.48, 29),
        ("Nikola Jokic", "player_assists", 9.5, 0.57, 0.50, 11),
        ("Luka Doncic", "player_threes", 3.5, 0.48, 0.42, 4),
        ("LeBron James", "player_rebounds", 7.5, 0.55, 0.48, 6),
        ("Jayson Tatum", "player_rebounds", 8.5, 0.52, 0.45, 10),
        ("Luka Doncic", "player_points", 28.5, 0.58, 0.52, 35),
        ("Nikola Jokic", "player_points", 26.5, 0.56, 0.50, 31),
        ("Anthony Edwards", "player_threes", 2.5, 0.62, 0.55, 3),
        ("LeBron James", "player_assists", 7.5, 0.54, 0.48, 8),
        ("Luka Doncic", "player_assists", 8.5, 0.53, 0.47, 7),
        ("Jayson Tatum", "player_points", 27.5, 0.55, 0.50, 25),
        ("Nikola Jokic", "player_rebounds", 12.5, 0.60, 0.52, 15),
        ("Shai Gilgeous-Alexander", "player_points", 31.5, 0.53, 0.47, 34),
        ("Anthony Edwards", "player_points", 24.5, 0.57, 0.50, 27),
        ("LeBron James", "player_points", 25.5, 0.54, 0.50, 23),
    ]

    log.info(f"Simulating {len(scenarios)} bets...\n")

    for player, market, line, model_prob, market_implied, actual in scenarios:
        edge = model_prob - market_implied
        if edge < config.MIN_EDGE_THRESHOLD:
            continue

        odds_decimal = 1 / market_implied
        odds_american = int((odds_decimal - 1) * 100) if odds_decimal >= 2 else int(-100 / (odds_decimal - 1))

        overlay = {
            "player": player, "market": market,
            "stat": market.replace("player_", "").upper(),
            "side": "Over", "line": line,
            "odds_american": odds_american, "odds_decimal": odds_decimal,
            "model_prob": model_prob, "market_implied": market_implied,
            "edge": edge,
            "tier": "STRONG" if edge >= 0.08 else ("MODERATE" if edge >= 0.05 else "MARGINAL"),
        }

        bet = sizer.size_bet(overlay)
        if bet.get("skip_reason"):
            continue

        tracker.record_bet(bet, sizer.bankroll)
        result = tracker.record_result(player, market, line, actual)

        if result:
            sizer.update_bankroll(result["running_bankroll"])
            status = "WIN " if result["result"] == "WIN" else "LOSS"
            log.info(f"  {status} {player:30s} {market.replace('player_', '').upper():8s} "
                     f"O {line:5.1f}  Actual: {actual:5.1f}  "
                     f"P&L: ${result['pnl']:+8.2f}  "
                     f"Bank: ${result['running_bankroll']:8.2f}")

    log.info(tracker.get_performance_report())


# ─── Scheduler ────────────────────────────────────────────────────────────────

def start_scheduler():
    """Start the scheduled runner. Runs indefinitely until killed."""
    log.info("=" * 60)
    log.info("WOODS SYSTEM — SCHEDULER STARTED")
    log.info(f"Mode: {MODE.upper()}")
    log.info(f"Scan time: {SCAN_TIME} ET")
    log.info(f"Results time: {RESULTS_TIME} ET")
    log.info("=" * 60)

    schedule.every().day.at(SCAN_TIME).do(run_scan_and_bet)
    schedule.every().day.at(RESULTS_TIME).do(run_results_and_report)

    # Graceful shutdown
    def handle_signal(sig, frame):
        log.info("Shutting down scheduler...")
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log.info("Scheduler running. Waiting for next scheduled task...")

    while True:
        schedule.run_pending()
        time.sleep(30)


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main():
    os.makedirs(config.DATA_DIR, exist_ok=True)

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "scan":
            run_scan_and_bet()
        elif cmd == "results":
            run_results_and_report()
        elif cmd == "backtest":
            run_backtest_demo()
        elif cmd == "schedule":
            start_scheduler()
        else:
            print(f"Unknown command: {cmd}")
            print("Usage: python runner.py [scan|results|backtest|schedule]")
    elif RUN_ONCE:
        # Single run mode (useful for cloud functions / cron)
        run_scan_and_bet()
    else:
        start_scheduler()


if __name__ == "__main__":
    main()
