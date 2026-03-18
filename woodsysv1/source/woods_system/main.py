#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════╗
║                     THE WOODS SYSTEM                                ║
║                                                                      ║
║   Named after Alan Woods (1945-2008), who turned mathematics         ║
║   and disciplined bet-sizing into a $200M+ fortune on the            ║
║   Hong Kong horse races.                                             ║
║                                                                      ║
║   "We only bet when the public has mispriced the odds."              ║
║                                                                      ║
║   This system applies Alan's principles to NBA player props:         ║
║   1. Calculate independent probabilities (the model)                 ║
║   2. Compare to market prices (find overlays)                        ║
║   3. Size bets with Kelly Criterion (manage risk)                    ║
║   4. Track results and refine (get smarter with each bet)            ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
    python main.py scan          — Scan today's props for overlays
    python main.py bet           — Generate a full bet card with sizing
    python main.py report        — Show performance report
    python main.py result        — Record a bet result
    python main.py backtest      — Run backtest on demo data
    python main.py               — Interactive mode
"""

import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_pipeline import OddsEngine, PlayerStatsEngine
from model import PropModel
from overlay_finder import OverlayFinder
from kelly import KellyBetSizer
from tracker import BetTracker
import config


def banner():
    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║              THE WOODS SYSTEM v1.0                          ║")
    print("║     'After each race, the computer got smarter.'            ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print()


def scan_overlays(verbose: bool = True) -> list[dict]:
    """
    Full pipeline: fetch odds → run model → find overlays.
    This is what Alan's team did before every Hong Kong race meeting.
    """
    if verbose:
        print("  [1/4] Fetching upcoming games and odds...")

    odds_engine = OddsEngine()
    games = odds_engine.get_upcoming_games()

    if verbose:
        print(f"        Found {len(games)} games")

    # Collect all props across all markets (deduplicated)
    all_props = []
    seen = set()
    for market in config.PROP_MARKETS:
        if verbose:
            print(f"  [2/4] Fetching {market} props...")
        for game in games:
            game_id = game.get("id", "demo")
            props = odds_engine.get_player_props(game_id, market)
            for p in props:
                key = (p["player"], p["market"], p["side"], p["line"])
                if key not in seen:
                    seen.add(key)
                    all_props.append(p)

    if verbose:
        # Count unique players
        players = set(p["player"] for p in all_props if p["side"] == "Over")
        print(f"        Found {len(all_props)} prop lines across {len(players)} players")

    # Run model predictions
    if verbose:
        print("  [3/4] Running model predictions...")

    model = PropModel()
    predictions = model.batch_predict(all_props)

    if verbose:
        print(f"        Generated {len(predictions)} predictions")

    # Find overlays
    if verbose:
        print("  [4/4] Scanning for overlays...")

    finder = OverlayFinder()
    overlays = finder.find_overlays(predictions)

    if verbose:
        report = finder.format_overlay_report(overlays)
        print(report)

    return overlays


def generate_bet_card(overlays: list[dict] = None):
    """Generate a Kelly-sized bet card from today's overlays."""
    if overlays is None:
        print("  Scanning for overlays first...\n")
        overlays = scan_overlays(verbose=False)

    if not overlays:
        print("\n  No overlays found today. Alan would say: patience.\n")
        return

    # Load current bankroll from tracker or use default
    tracker = BetTracker()
    sizer = KellyBetSizer()

    bets = sizer.size_all_bets(overlays)
    print(sizer.format_bet_card(bets))

    # Offer to record bets
    print("\n  Would you like to record these bets for tracking? (y/n)")
    try:
        response = input("  > ").strip().lower()
        if response == "y":
            for bet in bets:
                tracker.record_bet(bet, sizer.bankroll)
            print(f"\n  Recorded {len(bets)} bets. Use 'python main.py result' to log outcomes.")
    except (EOFError, KeyboardInterrupt):
        pass


def record_result():
    """Interactive result recording."""
    tracker = BetTracker()

    print("\n  Record a bet result:")
    try:
        player = input("  Player name: ").strip()
        market = input("  Market (player_points/player_rebounds/player_assists/player_threes): ").strip()
        line = float(input("  Line: ").strip())
        actual = float(input("  Actual stat: ").strip())

        result = tracker.record_result(player, market, line, actual)
        if result:
            emoji = "WIN" if result["result"] == "WIN" else "LOSS"
            print(f"\n  {emoji}: {result['result']}  |  "
                  f"P&L: ${result['pnl']:+,.2f}  |  "
                  f"Bankroll: ${result['running_bankroll']:,.2f}")
        else:
            print("\n  No matching pending bet found.")
    except (EOFError, KeyboardInterrupt, ValueError) as e:
        print(f"\n  Error: {e}")


def show_report():
    """Show performance report."""
    tracker = BetTracker()
    print(tracker.get_performance_report())


def run_backtest():
    """
    Run a backtest on demo data to show how the system works.
    This demonstrates the full pipeline end-to-end.
    """
    print("\n  Running backtest with demo data...")
    print("  (In production, this would use historical odds and results)\n")

    # Simulate a series of bets with known outcomes
    import random
    random.seed(42)  # Reproducible

    tracker = BetTracker(log_path="data/backtest_log.csv")
    sizer = KellyBetSizer(bankroll=5000)

    # Simulated scenarios: (player, market, line, model_prob, market_implied, actual_stat)
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

    print(f"  Simulating {len(scenarios)} bets...\n")

    for player, market, line, model_prob, market_implied, actual in scenarios:
        edge = model_prob - market_implied

        # Only bet if edge exceeds threshold (as the system would)
        if edge < config.MIN_EDGE_THRESHOLD:
            continue

        # Calculate odds from market implied (approximate)
        odds_decimal = 1 / market_implied
        odds_american = int((odds_decimal - 1) * 100) if odds_decimal >= 2 else int(-100 / (odds_decimal - 1))

        overlay = {
            "player": player,
            "market": market,
            "stat": market.replace("player_", "").upper(),
            "side": "Over",
            "line": line,
            "odds_american": odds_american,
            "odds_decimal": odds_decimal,
            "model_prob": model_prob,
            "market_implied": market_implied,
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
            print(f"  {status} {player:30s} {market.replace('player_', '').upper():8s} "
                  f"O {line:5.1f}  Actual: {actual:5.1f}  "
                  f"P&L: ${result['pnl']:+8.2f}  "
                  f"Bank: ${result['running_bankroll']:8.2f}")

    print(tracker.get_performance_report())


def interactive_mode():
    """Main interactive menu."""
    banner()

    while True:
        print("\n  Commands:")
        print("    [1] scan     — Scan today's props for overlays")
        print("    [2] bet      — Generate bet card with Kelly sizing")
        print("    [3] report   — View performance report")
        print("    [4] result   — Record a bet result")
        print("    [5] backtest — Run demo backtest")
        print("    [q] quit")
        print()

        try:
            choice = input("  > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  Goodbye. Remember: patience is the edge.\n")
            break

        if choice in ("1", "scan"):
            scan_overlays()
        elif choice in ("2", "bet"):
            generate_bet_card()
        elif choice in ("3", "report"):
            show_report()
        elif choice in ("4", "result"):
            record_result()
        elif choice in ("5", "backtest"):
            run_backtest()
        elif choice in ("q", "quit", "exit"):
            print("\n  Goodbye. Remember: patience is the edge.\n")
            break
        else:
            print("  Unknown command. Try again.")


def main():
    """Entry point — handles CLI args or launches interactive mode."""
    os.makedirs(config.DATA_DIR, exist_ok=True)

    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "scan":
            banner()
            scan_overlays()
        elif cmd == "bet":
            banner()
            generate_bet_card()
        elif cmd == "report":
            banner()
            show_report()
        elif cmd == "result":
            banner()
            record_result()
        elif cmd == "backtest":
            banner()
            run_backtest()
        else:
            print(f"Unknown command: {cmd}")
            print(__doc__)
    else:
        interactive_mode()


if __name__ == "__main__":
    main()
