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
import uuid
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
from live_monitor import run_live_monitor
from notifications import NotificationManager
from sports.registry import get_active_adapters, get_adapter
import config


# ─── Telegram Notifications ──────────────────────────────────────────────────

def send_telegram(msg: str):
    """Send notification via Telegram bot."""
    token = os.getenv('TELEGRAM_BOT_TOKEN', '')
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '')
    if not token or not chat_id:
        return
    try:
        import requests
        requests.post(f'https://api.telegram.org/bot{token}/sendMessage',
                      data={'chat_id': chat_id, 'text': msg, 'parse_mode': 'HTML'}, timeout=10)
    except Exception:
        pass


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

def run_scan_and_bet(sport_key: str = None):
    """
    Full pipeline: scan → predict → find overlays → size bets → execute.
    Runs for a specific sport, or NBA by default.
    """
    sport_key = sport_key or config.SPORT_KEY
    adapter = get_adapter(sport_key)
    sport_name = adapter.display_name if adapter else sport_key

    log.info("=" * 60)
    log.info(f"WOODS SYSTEM — SCAN & BET PIPELINE [{sport_name}]")
    log.info(f"Mode: {MODE.upper()} | Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    notifier = NotificationManager()

    try:
        # 1. Fetch odds
        log.info("[1/5] Fetching upcoming games and odds...")
        odds_engine = OddsEngine()
        games = odds_engine.get_upcoming_games(sport_key=sport_key)
        log.info(f"       Found {len(games)} games")

        # 2. Collect all props (deduplicated per game)
        markets = adapter.prop_markets if adapter else config.PROP_MARKETS
        all_props = []
        seen = set()
        for market in markets:
            log.info(f"[2/5] Fetching {market} props...")
            for game in games:
                game_id = game.get("id", "demo")
                home = game.get("home_team", "")
                away = game.get("away_team", "")
                game_time = game.get("commence_time", "")
                props = odds_engine.get_player_props(game_id, market, sport_key=sport_key)
                for p in props:
                    # Deduplicate per player+market+side+line+game
                    key = (p["player"], p["market"], p["side"], p["line"], game_id)
                    if key not in seen:
                        seen.add(key)
                        p["home_team"] = home
                        p["away_team"] = away
                        p["game_time"] = game_time
                        p["game_id"] = game_id
                        p["sport"] = sport_key
                        all_props.append(p)

        players = set(p["player"] for p in all_props if p["side"] == "Over")
        log.info(f"       {len(all_props)} prop lines across {len(players)} players")

        # 3. Run model — use sport adapter if available, else default PropModel
        log.info("[3/5] Running model predictions...")
        if adapter and sport_key != "basketball_nba":
            # Use sport-specific adapter for non-NBA
            predictions = []
            for prop in all_props:
                if prop["side"] != "Over":
                    continue
                pred = adapter.predict_over_probability(
                    player_name=prop["player"],
                    market=prop["market"],
                    line=prop["line"],
                    is_home=True,
                )
                if pred:
                    pred["market_implied_over"] = prop["implied_prob"]
                    pred["over_odds_decimal"] = prop["odds_decimal"]
                    pred["over_odds_american"] = prop["odds_american"]
                    pred["home_team"] = prop.get("home_team")
                    pred["away_team"] = prop.get("away_team")
                    pred["game_time"] = prop.get("game_time")
                    pred["game_id"] = prop.get("game_id", "")
                    pred["sport"] = sport_key
                    # Find under prop
                    under_prop = next(
                        (p for p in all_props
                         if p["player"] == prop["player"]
                         and p["market"] == prop["market"]
                         and p["side"] == "Under"),
                        None
                    )
                    if under_prop:
                        pred["market_implied_under"] = under_prop["implied_prob"]
                        pred["under_odds_decimal"] = under_prop["odds_decimal"]
                        pred["under_odds_american"] = under_prop["odds_american"]
                    predictions.append(pred)
        else:
            model = PropModel()
            predictions = model.batch_predict(all_props)
            for pred in predictions:
                pred["sport"] = sport_key

        log.info(f"       Generated {len(predictions)} predictions")

        # 4. Find overlays
        log.info("[4/5] Scanning for overlays...")
        finder = OverlayFinder()
        overlays = finder.find_overlays(predictions)
        report = finder.format_overlay_report(overlays)
        log.info(report)

        if not overlays:
            log.info(f"No overlays found for {sport_name}. Patience is the edge.")
            return

        # Tag overlays with sport
        for o in overlays:
            o["sport"] = sport_key

        # 5. Size bets and execute
        log.info("[5/5] Sizing bets and executing...")
        tracker = BetTracker()
        sizer = KellyBetSizer()
        bets = sizer.size_all_bets(overlays)
        bet_card = sizer.format_bet_card(bets)
        log.info(bet_card)

        # Write top overlays to scan_results (capped at 50 best)
        scan_id = str(uuid.uuid4())[:8]
        from database import Database
        db = Database()

        # Sort overlays by edge descending, cap at top 50
        overlays_sorted = sorted(overlays, key=lambda o: o.get("edge", 0), reverse=True)[:50]

        # Build scan result records from overlays + sizing info
        scan_records = []
        for overlay in overlays_sorted:
            # Find matching sized bet if it exists
            sized = next(
                (b for b in bets if b["player"] == overlay["player"]
                 and b["market"] == overlay["market"]
                 and b["line"] == overlay["line"]
                 and not b.get("skip_reason")),
                None
            )
            scan_records.append({
                "sport": sport_key,
                "player": overlay["player"],
                "market": overlay["market"],
                "side": overlay.get("side", "Over"),
                "line": overlay["line"],
                "odds_american": overlay.get("odds_american"),
                "odds_decimal": overlay.get("odds_decimal"),
                "model_prob": overlay.get("model_prob"),
                "market_implied": overlay.get("market_implied"),
                "edge": overlay.get("edge"),
                "tier": overlay.get("tier"),
                "confidence": overlay.get("confidence"),
                "kelly_pct": sized.get("adjusted_kelly_pct") if sized else None,
                "bet_size": sized.get("bet_size") if sized else None,
                "home_team": overlay.get("home_team"),
                "away_team": overlay.get("away_team"),
                "game_time": overlay.get("game_time"),
                "game_id": overlay.get("game_id", ""),
            })

        inserted = db.insert_scan_results(scan_records, scan_id)
        log.info(f"  Wrote {inserted} opportunities to scan_results (scan {scan_id})")

        # Set up exchange
        if MODE == "live":
            exchange = BetfairExchange()
        else:
            exchange = DryRunExchange(starting_balance=sizer.bankroll)

        bettor = AutoBettor(exchange=exchange, notifier=notifier)
        results = bettor.execute_bet_card(bets)

        # Look up jersey numbers and record bets
        for bet in bets:
            bet["sport"] = sport_key
            if adapter:
                jersey = adapter.get_player_jersey_number(bet["player"])
                if jersey:
                    bet["jersey_number"] = jersey
            record = tracker.record_bet(bet, sizer.bankroll)

            # Link placed bet back to scan_results
            if record and record.get("id"):
                # Find matching scan result and mark as PLACED
                try:
                    sr = db.client.table("scan_results").select("id").eq(
                        "scan_id", scan_id
                    ).eq("player", bet["player"]).eq(
                        "market", bet["market"]
                    ).eq("line", bet["line"]).limit(1).execute()
                    if sr.data:
                        db.mark_scan_result_placed(sr.data[0]["id"], record["id"])
                except Exception:
                    pass

        log.info(f"\nPlaced {len(results)} bets ({MODE} mode) [{sport_name}]")

        # Send notifications
        notifier.notify_bet_card(bets, sizer.bankroll)

    except Exception as e:
        log.exception(f"Pipeline error [{sport_name}]: {e}")
        notifier.notify_error(f"Scan pipeline failed [{sport_name}]: {e}")


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

def run_live_monitor_if_game_hours():
    """Run live monitor during active game hours for any sport."""
    hour = datetime.now().hour
    try:
        adapters = get_active_adapters()
        for adapter in adapters:
            start, end = adapter.get_game_hours()
            # Handle overnight ranges (e.g., 18-25 means 18-23 + 0-1)
            if end > 24:
                in_window = hour >= start or hour < (end - 24)
            else:
                in_window = start <= hour < end
            if in_window:
                run_live_monitor()
                return  # Only need to run once per cycle
    except Exception as e:
        log.exception(f"Live monitor error: {e}")


def _expire_scan_results():
    """Expire old scan results where game has already started."""
    try:
        from database import Database
        db = Database()
        db.expire_old_scan_results()
    except Exception as e:
        log.debug(f"Error expiring scan results: {e}")


def _check_manual_scan_requests():
    """Poll for manual scan requests from the dashboard."""
    try:
        from database import Database
        db = Database()
        request = db.get_manual_scan_request()
        if not request:
            return

        sport_key = request.get("sport_key", "all")
        log.info(f"Manual scan request received: sport={sport_key}")

        if sport_key == "all" or not sport_key:
            # Scan all active sports
            adapters = get_active_adapters()
            for adapter in adapters:
                try:
                    log.info(f"  Manual scan: {adapter.display_name}")
                    run_scan_and_bet(sport_key=adapter.sport_key)
                except Exception as e:
                    log.warning(f"  Manual scan error for {adapter.display_name}: {e}")
        else:
            run_scan_and_bet(sport_key=sport_key)

        # Clear the request so dashboard knows we're done
        db.clear_manual_scan_request()
        log.info("Manual scan request completed and cleared.")
    except Exception as e:
        log.exception(f"Error processing manual scan request: {e}")
        send_telegram(f"Scanner error (manual scan): {e}")


def _check_racing_scan_requests():
    """Poll for racing scan requests from the dashboard — writes fresh data to racing_overlays."""
    try:
        from database import Database
        db = Database()
        request = db.get_racing_scan_request()
        if not request:
            return

        log.info("Racing scan request received — scanning all AU meetings...")

        from horse_racing_model import HorseRacingModel
        model = HorseRacingModel()
        results = model.scan_all_meetings(hours_ahead=48)

        if results:
            import uuid
            scan_id = str(uuid.uuid4())[:8]

            # Add meeting info from event name
            for r in results:
                if not r.get('meeting'):
                    # Extract meeting from race name or market
                    r['meeting'] = r.get('race', '').split(' ')[0] if r.get('race') else ''

            inserted = db.insert_racing_overlays(results, scan_id)
            overlays = [r for r in results if r['verdict'] == 'OVERLAY']
            log.info(f"Racing scan complete: {len(results)} runners, {len(overlays)} overlays, {inserted} written to DB")
        else:
            log.info("Racing scan: no results found")

        db.clear_racing_scan_request()
        log.info("Racing scan request cleared.")
    except Exception as e:
        log.exception(f"Error processing racing scan request: {e}")
        send_telegram(f"Scanner error (racing scan): {e}")
        # Still try to clear the request so it doesn't loop
        try:
            from database import Database
            Database().clear_racing_scan_request()
        except Exception:
            pass


def _expire_racing_overlays():
    """Delete stale racing overlays older than 2 hours."""
    try:
        from database import Database
        db = Database()
        db.expire_racing_overlays(max_age_hours=2)
    except Exception as e:
        log.debug(f"Error expiring racing overlays: {e}")


def _check_mirror_bet_requests():
    """Poll for mirror bet requests from the dashboard."""
    try:
        from database import Database
        db = Database()
        request = db.get_config("mirror_bet_request")
        if not request or not isinstance(request, dict):
            return
        if request.get("status") != "pending":
            return

        bet_ids = request.get("bet_ids", [])
        live_stake = request.get("live_stake", 100)
        log.info(f"Mirror bet request: {len(bet_ids)} bets at ${live_stake} each")

        # Get the demo bets to mirror
        bets_to_mirror = []
        for bid in bet_ids:
            result = db.client.table("bets").select("*").eq("id", bid).single().execute()
            if result.data:
                bets_to_mirror.append(result.data)

        if not bets_to_mirror:
            log.warning("No valid bets found to mirror")
            db.set_config("mirror_bet_request", {**request, "status": "completed", "error": "No valid bets"})
            return

        # Connect to Betfair
        from betfair_client import BetfairClient
        bf = BetfairClient()
        if not bf.login():
            log.error("Failed to authenticate with Betfair for mirror bets")
            db.set_config("mirror_bet_request", {**request, "status": "failed", "error": "Auth failed"})
            return

        balance = bf.get_balance()
        log.info(f"  Betfair balance: ${balance:.2f}")

        placed = []
        for bet in bets_to_mirror:
            player = bet["player"]
            odds = bet.get("odds_decimal", 1.91) or 1.91
            side = bet.get("side", "Over")

            # For Betfair Exchange, we need a market_id and selection_id
            # Player props aren't directly on the Exchange, so we place as a
            # recorded live bet with the request logged for manual execution
            log.info(f"  Mirror: {player} {side} {bet.get('line')} @ {odds:.2f} for ${live_stake}")

            # Record the live bet in the bets table
            live_bet = {
                "player": player,
                "market": bet.get("market"),
                "stat": bet.get("stat"),
                "side": side,
                "line": bet.get("line"),
                "odds_american": bet.get("odds_american"),
                "odds_decimal": odds,
                "model_prob": bet.get("model_prob"),
                "market_implied": bet.get("market_implied"),
                "edge": bet.get("edge"),
                "tier": bet.get("tier"),
                "bet_size": live_stake,
                "bankroll_at_bet": balance,
                "home_team": bet.get("home_team"),
                "away_team": bet.get("away_team"),
                "game_time": bet.get("game_time"),
                "jersey_number": bet.get("jersey_number"),
                "sport": bet.get("sport"),
                "result": "PENDING",
                "notes": f"LIVE MIRROR of demo bet #{bet['id']} | Betfair",
                "commission_rate": 0.05,
            }
            try:
                result = db.client.table("bets").insert(live_bet).execute()
                if result.data:
                    placed.append(result.data[0])
                    log.info(f"    Recorded live bet #{result.data[0]['id']}")
            except Exception as e:
                log.error(f"    Failed to record: {e}")

        # Mark request as completed
        db.set_config("mirror_bet_request", {
            **request,
            "status": "completed",
            "placed_count": len(placed),
            "completed_at": datetime.now().isoformat(),
        })
        log.info(f"Mirror complete: {len(placed)} live bets placed at ${live_stake} each")

    except Exception as e:
        log.exception(f"Error processing mirror bet request: {e}")


def run_scan_for_sport(sport_key: str):
    """Wrapper to pass sport_key to the scan pipeline."""
    def _run():
        run_scan_and_bet(sport_key=sport_key)
    return _run


def run_autonomous_racing_scan():
    """Autonomous racing scan: scan meetings, filter gallops, insert overlays, notify via Telegram."""
    max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        try:
            log.info(f"Autonomous racing scan (attempt {attempt}/{max_attempts})...")

            from horse_racing_model import HorseRacingModel
            model = HorseRacingModel()
            results = model.scan_all_meetings(hours_ahead=72)

            if not results:
                log.info("Autonomous racing scan: no results found")
                send_telegram("Racing scan: no meetings found")
                return

            # --- Filter: GALLOPS ONLY (exclude harness/trots/pace) ---
            excluded_keywords = ("pace", "trot", "harness")
            gallops = [
                r for r in results
                if not any(kw in (r.get('race', '') or '').lower() for kw in excluded_keywords)
            ]
            log.info(f"  Filtered to {len(gallops)} gallop runners (excluded {len(results) - len(gallops)} harness/trot/pace)")

            # --- Safety limits ---
            # Only OVERLAY verdicts
            overlays = [r for r in gallops if r.get('verdict') == 'OVERLAY']

            # Min field size 8
            overlays = [r for r in overlays if r.get('field_size', 0) >= 8]

            # Max 1 per race (best W.E.)
            best_per_race = {}
            for r in overlays:
                race_key = r.get('market_id', r.get('race', ''))
                if race_key not in best_per_race or r.get('we_net', 0) > best_per_race[race_key].get('we_net', 0):
                    best_per_race[race_key] = r
            overlays = list(best_per_race.values())

            # Max 3 per meeting
            from collections import defaultdict
            meeting_counts = defaultdict(list)
            for r in sorted(overlays, key=lambda x: x.get('we_net', 0), reverse=True):
                meeting = r.get('meeting', '') or r.get('race', '').split(' ')[0]
                if len(meeting_counts[meeting]) < 3:
                    meeting_counts[meeting].append(r)
            filtered = []
            for runners in meeting_counts.values():
                filtered.extend(runners)

            log.info(f"  After safety limits: {len(filtered)} overlays from {len(meeting_counts)} meetings")

            # --- Insert into database ---
            if filtered:
                import uuid as _uuid
                scan_id = str(_uuid.uuid4())[:8]
                from database import Database
                db = Database()

                # Ensure meeting field is populated
                for r in filtered:
                    if not r.get('meeting'):
                        r['meeting'] = r.get('race', '').split(' ')[0] if r.get('race') else ''

                inserted = db.insert_racing_overlays(filtered, scan_id)
                log.info(f"  Inserted {inserted} racing overlays (scan {scan_id})")
            else:
                inserted = 0

            # Count unique meetings scanned
            meetings_scanned = len(set(
                r.get('meeting', '') or r.get('race', '').split(' ')[0]
                for r in gallops
            ))

            send_telegram(
                f"<b>Racing Scan Complete</b>\n"
                f"Scanned {meetings_scanned} meetings, {len(filtered)} overlays (gallops only)\n"
                f"Total runners analysed: {len(gallops)}"
            )
            return  # Success, exit retry loop

        except Exception as e:
            log.exception(f"Autonomous racing scan error (attempt {attempt}): {e}")
            if attempt < max_attempts:
                log.info(f"  Retrying in 60 seconds...")
                time.sleep(60)
            else:
                send_telegram(f"Racing scan FAILED after {max_attempts} attempts: {e}")


def send_daily_summary():
    """Send end-of-day Telegram summary of today's betting activity."""
    try:
        from database import Database
        db = Database()
        if not db.enabled:
            return

        today = datetime.now().strftime('%Y-%m-%d')
        result = db.client.table("bets").select("*").gte(
            "created_at", f"{today}T00:00:00"
        ).lte("created_at", f"{today}T23:59:59").execute()

        bets = result.data if result.data else []
        if not bets:
            send_telegram(f"<b>Daily Summary ({today})</b>\nNo bets placed today.")
            return

        wins = [b for b in bets if b.get('result') == 'WIN']
        losses = [b for b in bets if b.get('result') == 'LOSS']
        pending = [b for b in bets if b.get('result') == 'PENDING']
        pnl = sum(b.get('pnl', 0) or 0 for b in bets if b.get('pnl') is not None)

        # Get latest bankroll from most recent settled bet
        settled = [b for b in bets if b.get('running_bankroll')]
        bankroll = settled[-1]['running_bankroll'] if settled else 'N/A'
        bankroll_str = f"${bankroll:,.2f}" if isinstance(bankroll, (int, float)) else bankroll

        send_telegram(
            f"<b>Daily Summary ({today})</b>\n"
            f"{len(wins)}W/{len(losses)}L ({len(pending)} pending) | "
            f"P&L: ${pnl:+,.2f} | Bankroll: {bankroll_str}"
        )
        log.info(f"Daily summary sent: {len(wins)}W/{len(losses)}L, P&L: ${pnl:+,.2f}")

    except Exception as e:
        log.exception(f"Error sending daily summary: {e}")
        send_telegram(f"Daily summary error: {e}")


def _refresh_betfair_session():
    """Refresh Betfair session to prevent timeout."""
    try:
        from betfair_client import BetfairClient
        bf = BetfairClient()
        if bf.login():
            balance = bf.get_balance()
            log.info(f"Betfair session refreshed. Balance: ${balance:.2f}")
        else:
            log.warning("Betfair session refresh failed")
            send_telegram("Betfair session refresh FAILED — check credentials")
    except Exception as e:
        log.warning(f"Betfair session refresh error: {e}")


def start_scheduler():
    """Start the scheduled runner. Runs indefinitely until killed."""
    log.info("=" * 60)
    log.info("WOODS SYSTEM — SCHEDULER STARTED")
    log.info(f"Mode: {MODE.upper()}")
    log.info("=" * 60)

    # Schedule scans for each active sport at their optimal pre-game time
    adapters = get_active_adapters()
    for adapter in adapters:
        scan_time = adapter.get_scan_time()
        log.info(f"  {adapter.display_name}: scan at {scan_time} ET, "
                 f"games {adapter.get_game_hours()[0]}:00–{adapter.get_game_hours()[1] % 24}:00 ET")
        schedule.every().day.at(scan_time).do(run_scan_for_sport(adapter.sport_key))

    schedule.every().day.at(RESULTS_TIME).do(run_results_and_report)
    schedule.every(2).minutes.do(run_live_monitor_if_game_hours)
    schedule.every(1).hours.do(_expire_scan_results)
    schedule.every(30).seconds.do(_check_manual_scan_requests)
    schedule.every(30).seconds.do(_check_racing_scan_requests)
    schedule.every(30).minutes.do(_expire_racing_overlays)
    schedule.every(30).seconds.do(_check_mirror_bet_requests)

    # Autonomous racing scan and daily summary
    schedule.every(4).hours.do(run_autonomous_racing_scan)
    schedule.every().day.at("20:00").do(send_daily_summary)

    # Betfair session keep-alive
    schedule.every(2).hours.do(_refresh_betfair_session)

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
        elif cmd == "live":
            run_live_monitor()
        elif cmd == "schedule":
            start_scheduler()
        else:
            print(f"Unknown command: {cmd}")
            print("Usage: python runner.py [scan|results|backtest|live|schedule]")
    elif RUN_ONCE:
        # Single run mode (useful for cloud functions / cron)
        run_scan_and_bet()
    else:
        start_scheduler()


if __name__ == "__main__":
    main()
