"""
Woods System — AFL Player Goal-Scoring Model

Calculates the probability of an AFL player scoring Over/Under X.5 goals
using a Poisson distribution fitted to their recent goal-scoring rate.

This is Alan Woods' approach adapted for AFL: estimate the true probability
from data, then compare to the market odds to find overlays.

Win Expectation = P(goals > line) × back_odds
If W.E. > 1.0 → overlay (bet)
If W.E. < 0.82 → underlay (avoid)
"""

import math
from scipy import stats as scipy_stats


# ---------------------------------------------------------------------------
# Player goal data: (goals_2025, games_2025, goals_2026, games_2026)
# Source: afltables.com
# ---------------------------------------------------------------------------

HAWTHORN_PLAYERS = {
    "Jack Gunston":       {"g25": 73, "gp25": 25, "g26": 9, "gp26": 2},
    "Nick Watson":        {"g25": 36, "gp25": 23, "g26": 6, "gp26": 2},
    "Mabior Chol":        {"g25": 42, "gp25": 24, "g26": 3, "gp26": 2},
    "Jack Ginnivan":      {"g25": 29, "gp25": 24, "g26": 3, "gp26": 2},
    "Dylan Moore":        {"g25": 23, "gp25": 25, "g26": 1, "gp26": 2},
    "Connor MacDonald":   {"g25": 22, "gp25": 25, "g26": 2, "gp26": 2},
    "Mitch Lewis":        {"g25":  8, "gp25":  6, "g26": 1, "gp26": 2},
    "Sam Butler":         {"g25":  3, "gp25":  4, "g26": 2, "gp26": 2},
    "Jai Newcombe":       {"g25": 11, "gp25": 25, "g26": 1, "gp26": 2},
    "Calsher Dear":       {"g25": 10, "gp25": 25, "g26": 0, "gp26": 0},
    "Ned Reeves":         {"g25":  0, "gp25": 20, "g26": 2, "gp26": 2},
    "Josh Weddle":        {"g25":  0, "gp25": 20, "g26": 2, "gp26": 2},
    "Lloyd Meek":         {"g25": 10, "gp25": 24, "g26": 1, "gp26": 2},
    "Massimo D'Ambrosio": {"g25":  0, "gp25": 15, "g26": 1, "gp26": 2},
    "Conor Nash":         {"g25":  0, "gp25": 20, "g26": 1, "gp26": 2},
}

SYDNEY_PLAYERS = {
    "Joel Amartey":       {"g25": 13, "gp25": 16, "g26": 8, "gp26": 2},
    "Charlie Curnow":     {"g25":  0, "gp25":  0, "g26": 3, "gp26": 2},  # Traded to Sydney 2026
    "Isaac Heeney":       {"g25": 37, "gp25": 23, "g26": 4, "gp26": 2},
    "Tom Papley":         {"g25": 10, "gp25": 11, "g26": 1, "gp26": 2},
    "Logan McDonald":     {"g25":  0, "gp25":  0, "g26": 3, "gp26": 2},
    "Justin McInerney":   {"g25":  8, "gp25": 18, "g26": 5, "gp26": 2},
    "Errol Gulden":       {"g25":  6, "gp25": 10, "g26": 1, "gp26": 2},
    "Chad Warner":        {"g25": 20, "gp25": 23, "g26": 1, "gp26": 2},
    "Brodie Grundy":      {"g25":  7, "gp25": 22, "g26": 2, "gp26": 2},
    "Matt Roberts":       {"g25":  1, "gp25": 13, "g26": 2, "gp26": 2},
    "Malcolm Rosas":      {"g25":  0, "gp25":  0, "g26": 2, "gp26": 2},
    "Nick Blakey":        {"g25": 10, "gp25": 23, "g26": 1, "gp26": 2},
    "Will Hayward":       {"g25": 29, "gp25": 22, "g26": 0, "gp26": 0},
    "Hayden McLean":      {"g25": 25, "gp25": 21, "g26": 0, "gp26": 0},
    "James Rowbottom":    {"g25":  9, "gp25": 23, "g26": 1, "gp26": 2},
    "Angus Sheldrick":    {"g25":  6, "gp25": 17, "g26": 1, "gp26": 2},
    "Braeden Campbell":   {"g25": 16, "gp25": 23, "g26": 0, "gp26": 0},
    "Caiden Cleary":      {"g25":  1, "gp25": 13, "g26": 0, "gp26": 0},
}


def estimate_goals_per_game(player_data: dict) -> float:
    """
    Estimate a player's expected goals per game using weighted average.
    2026 data weighted 2x (recent form) vs 2025 data weighted 1x (larger sample).
    """
    g25 = player_data["g25"]
    gp25 = player_data["gp25"]
    g26 = player_data["g26"]
    gp26 = player_data["gp26"]

    if gp26 > 0 and gp25 > 0:
        avg_25 = g25 / gp25
        avg_26 = g26 / gp26
        # Weight 2026 at 2x because it's current form
        weighted = (avg_25 * gp25 + avg_26 * gp26 * 2) / (gp25 + gp26 * 2)
        return weighted
    elif gp26 > 0:
        return g26 / gp26
    elif gp25 > 0:
        return g25 / gp25
    else:
        return 0.5  # Unknown player fallback


def prob_over_goals(expected_gpg: float, line: float) -> float:
    """
    Calculate P(goals > line) using Poisson distribution.
    Goals in AFL are discrete, low-count events — Poisson is ideal.

    P(Over 1.5) = P(goals >= 2) = 1 - P(goals <= 1) = 1 - CDF(1)
    """
    if expected_gpg <= 0:
        return 0.01

    # Poisson CDF: P(X <= k) where k = floor(line)
    k = int(line)  # For line 1.5, k = 1 → P(X <= 1)
    prob_under = scipy_stats.poisson.cdf(k, expected_gpg)
    prob_over = 1 - prob_under

    # Clamp to avoid extremes
    return max(0.01, min(0.99, prob_over))


def analyse_player(name: str, data: dict, team: str) -> dict:
    """Analyse a single player's goal-scoring model."""
    gpg = estimate_goals_per_game(data)
    lines = [0.5, 1.5, 2.5, 3.5]

    results = {
        "player": name,
        "team": team,
        "goals_per_game": round(gpg, 2),
        "games_2025": data["gp25"],
        "goals_2025": data["g25"],
        "games_2026": data["gp26"],
        "goals_2026": data["g26"],
        "lines": {},
    }

    for line in lines:
        prob = prob_over_goals(gpg, line)
        results["lines"][f"over_{line}"] = round(prob, 4)
        results["lines"][f"under_{line}"] = round(1 - prob, 4)

    return results


def scan_betfair_overlays():
    """
    Compare model probabilities to Betfair market prices.
    Calculate Win Expectation for each selection.
    """
    from betfair_client import BetfairClient
    bf = BetfairClient()
    if not bf.login():
        print("Failed to login to Betfair")
        return []

    # Find Hawks vs Swans
    events = bf._betting_call("listEvents", {
        "filter": {"eventTypeIds": ["61420"], "textQuery": "Hawthorn"},
        "maxResults": "5",
    })
    if not events:
        print("No Hawthorn game found on Betfair")
        return []

    ev = events[0]["event"]
    event_id = ev["id"]
    print(f"\n{'='*70}")
    print(f"  AFL OVERLAY SCANNER: {ev['name']}")
    print(f"  Start: {ev.get('openDate', '?')}")
    print(f"{'='*70}")

    # Get all markets
    markets = bf._betting_call("listMarketCatalogue", {
        "filter": {"eventIds": [event_id]},
        "maxResults": "50",
        "marketProjection": ["RUNNER_DESCRIPTION"],
    })

    # Build player database
    all_players = {}
    for name, data in HAWTHORN_PLAYERS.items():
        all_players[name.lower()] = analyse_player(name, data, "Hawthorn")
    for name, data in SYDNEY_PLAYERS.items():
        all_players[name.lower()] = analyse_player(name, data, "Sydney")

    overlays = []

    for m in markets:
        market_name = m["marketName"]
        market_id = m["marketId"]

        # Check if it's a player goal market
        is_goal_market = "Goals -" in market_name or "First Goalscorer" in market_name or "Most Disposals" in market_name

        if not is_goal_market:
            continue

        # Get prices
        book = bf.get_market_prices(market_id)

        for br in book.get("runners", []):
            runner_name = next(
                (r["runnerName"] for r in m.get("runners", [])
                 if r["selectionId"] == br["selectionId"]),
                "Unknown"
            )
            backs = br.get("ex", {}).get("availableToBack", [])
            lays = br.get("ex", {}).get("availableToLay", [])

            if not backs or backs[0]["size"] < 10:
                continue

            back_price = backs[0]["price"]
            back_size = backs[0]["size"]
            lay_price = lays[0]["price"] if lays else None

            # Match runner to our player model
            model_prob = None
            player_model = None

            if "Goals -" in market_name:
                # Extract player name from market name: "Goals - Jack Gunston"
                player_in_market = market_name.replace("Goals - ", "").strip()
                player_model = all_players.get(player_in_market.lower())

                if player_model and "Over" in runner_name:
                    # Extract line from runner name: "Over 1.5 Goals"
                    try:
                        line = float(runner_name.split()[1])
                        model_prob = player_model["lines"].get(f"over_{line}")
                    except (IndexError, ValueError):
                        pass
                elif player_model and "Under" in runner_name:
                    try:
                        line = float(runner_name.split()[1])
                        model_prob = player_model["lines"].get(f"under_{line}")
                    except (IndexError, ValueError):
                        pass

            elif "First Goalscorer" in market_name:
                # First goal scorer — use P(scores 1+ goals) as rough proxy
                player_model = all_players.get(runner_name.lower())
                if player_model:
                    model_prob = player_model["lines"].get("over_0.5")

            if model_prob is None or model_prob <= 0:
                continue

            # Filter: don't bet Under on premium forwards (Tim's instruction)
            if player_model and "Under" in runner_name and player_model["goals_per_game"] >= 1.0:
                continue

            # Win Expectation = model probability × back odds
            we = round(model_prob * back_price, 3)

            # Market implied probability
            market_implied = round(1 / back_price, 4)

            # Edge = model_prob - market_implied
            edge = round(model_prob - market_implied, 4)

            # Betfair W.E. using lay as true prob
            betfair_we = 0
            if lay_price and lay_price > 1:
                betfair_we = round((1 / lay_price) * back_price, 3)

            verdict = "OVERLAY" if we > 1.0 else "MARGINAL" if we >= 0.82 else "UNDERLAY"

            entry = {
                "player": runner_name if "First Goalscorer" in market_name else player_model["player"],
                "team": player_model["team"] if player_model else "?",
                "market": market_name,
                "selection": runner_name,
                "gpg": player_model["goals_per_game"] if player_model else 0,
                "model_prob": model_prob,
                "market_implied": market_implied,
                "edge": edge,
                "back_price": back_price,
                "back_size": back_size,
                "lay_price": lay_price,
                "we_model": we,
                "we_betfair": betfair_we,
                "verdict": verdict,
            }
            overlays.append(entry)

            color = "\033[92m" if we > 1.0 else "\033[93m" if we >= 0.82 else "\033[91m"
            reset = "\033[0m"

            print(
                f"\n  {color}[{verdict:9s}]{reset} {entry['player']}"
                f"\n    {market_name}: {runner_name}"
                f"\n    Model: {model_prob:.1%} (avg {entry['gpg']:.1f} gpg)"
                f"  |  Market: {market_implied:.1%}"
                f"  |  Edge: {edge:+.1%}"
                f"\n    Back {back_price:.2f} (${back_size:.0f})"
                f"  |  Lay {lay_price or 0:.2f}"
                f"  |  W.E. = {we:.3f}"
            )

    # Sort by W.E. descending
    overlays.sort(key=lambda x: x["we_model"], reverse=True)

    print(f"\n{'='*70}")
    print(f"  SUMMARY: {len(overlays)} selections analysed")
    overlays_found = [o for o in overlays if o["we_model"] > 1.0]
    marginals = [o for o in overlays if 0.82 <= o["we_model"] <= 1.0]
    print(f"  Overlays (W.E. > 1.0): {len(overlays_found)}")
    print(f"  Marginal (0.82-1.0):   {len(marginals)}")
    print(f"  Underlays (< 0.82):    {len(overlays) - len(overlays_found) - len(marginals)}")
    print(f"{'='*70}")

    return overlays


# ======================================================================
# CLI
# ======================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("  Woods System — AFL Goal Model")
    print("  Hawthorn vs Sydney Swans (Thursday)")
    print("=" * 70)

    # Show model estimates first
    print("\n  HAWTHORN goal-scoring rates:")
    for name, data in sorted(HAWTHORN_PLAYERS.items(), key=lambda x: estimate_goals_per_game(x[1]), reverse=True):
        gpg = estimate_goals_per_game(data)
        p_over_1 = prob_over_goals(gpg, 1.5)
        print(f"    {name:25s} {gpg:>4.1f} gpg | P(2+ goals) = {p_over_1:.1%}")

    print("\n  SYDNEY goal-scoring rates:")
    for name, data in sorted(SYDNEY_PLAYERS.items(), key=lambda x: estimate_goals_per_game(x[1]), reverse=True):
        gpg = estimate_goals_per_game(data)
        p_over_1 = prob_over_goals(gpg, 1.5)
        print(f"    {name:25s} {gpg:>4.1f} gpg | P(2+ goals) = {p_over_1:.1%}")

    # Scan Betfair for overlays
    results = scan_betfair_overlays()

    if results:
        print("\n\n  TOP BETS BY WIN EXPECTATION:")
        for i, r in enumerate(results[:10], 1):
            color = "\033[92m" if r["we_model"] > 1.0 else "\033[93m" if r["we_model"] >= 0.82 else "\033[91m"
            reset = "\033[0m"
            print(
                f"  {i:2d}. {color}W.E. {r['we_model']:.3f}{reset}"
                f"  {r['player']:20s}"
                f"  {r['selection']:20s}"
                f"  Back {r['back_price']:.2f} (${r['back_size']:.0f})"
                f"  Model {r['model_prob']:.1%}"
                f"  Edge {r['edge']:+.1%}"
            )
