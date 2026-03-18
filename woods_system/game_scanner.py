"""
Woods System — Game-Level Overlay Scanner
Named after Alan Woods, the legendary quantitative gambler.

Scans across all sports for game-level overlays (h2h, spreads, totals)
by comparing odds across every available bookmaker. Finds the best price,
calculates edge vs. market average, and flags overlays worth betting.

Alan's core insight: the crowd sets a price, but there's always a bookmaker
offering better value. Find the outlier, verify the edge, and bet.
"""

import statistics
from datetime import datetime, timezone, timedelta

import requests

import config

# ---------------------------------------------------------------------------
# Supported sports with friendly labels
# ---------------------------------------------------------------------------
SUPPORTED_SPORTS = {
    "aussierules_afl": "AFL",
    "basketball_nba": "NBA",
    "soccer_epl": "EPL",
    "soccer_uefa_champions_league": "UCL",
    "americanfootball_nfl": "NFL",
}

# Markets to scan for each game
MARKETS = ["h2h", "spreads", "totals"]

# Minimum edge percentage to flag as an overlay
MIN_EDGE_PCT = 3.0

# Betfair bookmaker keys (The Odds API naming)
BETFAIR_KEYS = {"betfair_ex_au", "betfair_ex_eu", "betfair_ex_uk", "betfair"}

BASE_URL = "https://api.the-odds-api.com/v4"


class GameOverlayScanner:
    """
    Scans game-level markets across bookmakers to find overlays.

    For each game/market/selection, compares odds from all bookmakers
    to find where the best price diverges significantly from the
    market average — that divergence is the overlay.
    """

    def __init__(self, api_key: str = None, hours_ahead: int = 72):
        self.api_key = api_key or config.ODDS_API_KEY
        self.hours_ahead = hours_ahead
        self._remaining_requests = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan_all_sports(self) -> list[dict]:
        """Scan every supported sport and return all overlays found."""
        all_overlays = []
        for sport_key in SUPPORTED_SPORTS:
            overlays = self.scan_sport(sport_key)
            all_overlays.extend(overlays)
        all_overlays.sort(key=lambda o: o["edge_pct"], reverse=True)
        return all_overlays

    def scan_sport(self, sport_key: str) -> list[dict]:
        """Fetch all upcoming games for a sport and find overlays."""
        label = SUPPORTED_SPORTS.get(sport_key, sport_key)
        print(f"\n{'='*60}")
        print(f"Scanning {label} ({sport_key})")
        print(f"{'='*60}")

        games = self._fetch_games(sport_key)
        if not games:
            print(f"  No upcoming games found for {label}")
            return []

        print(f"  Found {len(games)} upcoming games")
        overlays = []

        for game in games:
            game_overlays = self._analyse_game(sport_key, game)
            overlays.extend(game_overlays)

        overlays.sort(key=lambda o: o["edge_pct"], reverse=True)
        print(f"  => {len(overlays)} overlays found for {label}")
        return overlays

    def scan_game(self, sport_key: str, event_id: str) -> list[dict]:
        """Detailed overlay analysis for a single game by event ID."""
        label = SUPPORTED_SPORTS.get(sport_key, sport_key)
        print(f"\nScanning game {event_id} ({label})")

        game = self._fetch_single_game(sport_key, event_id)
        if not game:
            print(f"  Game {event_id} not found")
            return []

        overlays = self._analyse_game(sport_key, game)
        overlays.sort(key=lambda o: o["edge_pct"], reverse=True)
        return overlays

    # ------------------------------------------------------------------
    # API requests
    # ------------------------------------------------------------------

    def _fetch_games(self, sport_key: str) -> list[dict]:
        """Fetch upcoming games with odds across all bookmakers."""
        if self.api_key == "YOUR_API_KEY_HERE":
            print("ERROR: No Odds API key configured. Set ODDS_API_KEY in .env")
            return []

        try:
            url = f"{BASE_URL}/sports/{sport_key}/odds/"
            params = {
                "apiKey": self.api_key,
                "regions": "au,us,eu",
                "markets": ",".join(MARKETS),
                "oddsFormat": "decimal",
            }
            resp = requests.get(url, params=params, timeout=20)
            resp.raise_for_status()

            # Track API usage
            self._remaining_requests = resp.headers.get(
                "x-requests-remaining", self._remaining_requests
            )

            all_games = resp.json()

            # Filter to games within the lookahead window
            now = datetime.now(timezone.utc)
            cutoff = now + timedelta(hours=self.hours_ahead)
            filtered = []
            for game in all_games:
                commence = game.get("commence_time", "")
                if not commence:
                    continue
                try:
                    ct = datetime.fromisoformat(commence.replace("Z", "+00:00"))
                    if now < ct <= cutoff:
                        filtered.append(game)
                except (ValueError, TypeError):
                    pass

            if self._remaining_requests is not None:
                print(f"  API requests remaining: {self._remaining_requests}")

            return filtered

        except requests.exceptions.HTTPError as e:
            print(f"  HTTP error fetching {sport_key}: {e}")
            return []
        except Exception as e:
            print(f"  Error fetching {sport_key}: {e}")
            return []

    def _fetch_single_game(self, sport_key: str, event_id: str) -> dict | None:
        """Fetch odds for a single game by event ID."""
        if self.api_key == "YOUR_API_KEY_HERE":
            print("ERROR: No Odds API key configured. Set ODDS_API_KEY in .env")
            return None

        try:
            url = f"{BASE_URL}/sports/{sport_key}/events/{event_id}/odds"
            params = {
                "apiKey": self.api_key,
                "regions": "au,us,eu",
                "markets": ",".join(MARKETS),
                "oddsFormat": "decimal",
            }
            resp = requests.get(url, params=params, timeout=20)
            resp.raise_for_status()
            self._remaining_requests = resp.headers.get(
                "x-requests-remaining", self._remaining_requests
            )
            return resp.json()

        except Exception as e:
            print(f"  Error fetching game {event_id}: {e}")
            return None

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    def _analyse_game(self, sport_key: str, game: dict) -> list[dict]:
        """Analyse a single game across all markets and return overlays."""
        label = SUPPORTED_SPORTS.get(sport_key, sport_key)
        home = game.get("home_team", "Unknown")
        away = game.get("away_team", "Unknown")
        event_id = game.get("id", "")
        commence = game.get("commence_time", "")

        bookmakers = game.get("bookmakers", [])
        if not bookmakers:
            return []

        overlays = []

        for market_key in MARKETS:
            market_overlays = self._analyse_market(
                sport_key=sport_key,
                label=label,
                event_id=event_id,
                home=home,
                away=away,
                commence=commence,
                market_key=market_key,
                bookmakers=bookmakers,
            )
            overlays.extend(market_overlays)

        return overlays

    def _analyse_market(
        self,
        sport_key: str,
        label: str,
        event_id: str,
        home: str,
        away: str,
        commence: str,
        market_key: str,
        bookmakers: list[dict],
    ) -> list[dict]:
        """Analyse a single market (h2h/spreads/totals) across all bookmakers."""

        # Collect all outcomes by selection key
        # selection_key = (name, point) to group equivalent outcomes
        selection_data: dict[tuple, list[dict]] = {}

        for bk in bookmakers:
            bk_key = bk.get("key", "")
            bk_title = bk.get("title", bk_key)

            for market in bk.get("markets", []):
                if market.get("key") != market_key:
                    continue

                for outcome in market.get("outcomes", []):
                    name = outcome.get("name", "")
                    price = outcome.get("price")
                    point = outcome.get("point")  # spread or total line

                    if price is None or price <= 1.0:
                        continue

                    sel_key = (name, point)
                    if sel_key not in selection_data:
                        selection_data[sel_key] = []

                    selection_data[sel_key].append({
                        "bookmaker": bk_key,
                        "title": bk_title,
                        "price": float(price),
                    })

        # Evaluate each selection for overlays
        overlays = []
        for (sel_name, sel_point), entries in selection_data.items():
            if len(entries) < 3:
                # Need at least 3 bookmakers for meaningful comparison
                continue

            prices = [e["price"] for e in entries]
            best_entry = max(entries, key=lambda e: e["price"])
            worst_price = min(prices)
            avg_price = statistics.mean(prices)

            if avg_price <= 1.0:
                continue

            edge_pct = (best_entry["price"] / avg_price - 1) * 100
            implied_prob = 1.0 / avg_price

            if edge_pct < MIN_EDGE_PCT:
                continue

            # Determine tier
            if edge_pct >= 8.0:
                tier = "STRONG"
            elif edge_pct >= 5.0:
                tier = "MODERATE"
            else:
                tier = "MARGINAL"

            # Find Betfair odds
            betfair_back = None
            betfair_lay = None
            for e in entries:
                if e["bookmaker"] in BETFAIR_KEYS:
                    betfair_back = e["price"]
                    # Lay price approximation: slightly above back
                    # The Odds API only provides back prices for exchange;
                    # estimate lay as back + 1 tick (~0.02 for odds < 5)
                    betfair_lay = round(e["price"] + 0.02, 2)
                    break

            overlay = {
                "sport": sport_key,
                "sport_label": label,
                "event_id": event_id,
                "home_team": home,
                "away_team": away,
                "commence_time": commence,
                "market": market_key,
                "selection": sel_name,
                "line": sel_point,
                "best_odds": round(best_entry["price"], 3),
                "best_book": best_entry["bookmaker"],
                "avg_odds": round(avg_price, 3),
                "worst_odds": round(worst_price, 3),
                "edge_pct": round(edge_pct, 1),
                "implied_prob": round(implied_prob, 4),
                "num_bookmakers": len(entries),
                "betfair_back": betfair_back,
                "betfair_lay": betfair_lay,
                "tier": tier,
            }
            overlays.append(overlay)

            print(
                f"    [{tier:8s}] {sel_name}"
                f" ({market_key}{f' {sel_point}' if sel_point else ''})"
                f"  best={best_entry['price']:.2f} @ {best_entry['bookmaker']}"
                f"  avg={avg_price:.2f}  edge={edge_pct:.1f}%"
            )

        return overlays

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    @property
    def api_requests_remaining(self) -> str | None:
        """Return remaining API quota if known."""
        return self._remaining_requests


# ======================================================================
# CLI entry point
# ======================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("  Woods System — Game Overlay Scanner")
    print("  Scanning AFL for overlays...")
    print("=" * 60)

    scanner = GameOverlayScanner()
    results = scanner.scan_sport("aussierules_afl")

    if not results:
        print("\nNo overlays found. This can happen if:")
        print("  - No upcoming AFL games in the next 72 hours")
        print("  - Odds are tightly aligned across bookmakers")
        print("  - API key is not configured (check .env)")
    else:
        print(f"\n{'='*60}")
        print(f"  Top Overlays ({len(results)} found)")
        print(f"{'='*60}")
        for i, o in enumerate(results[:20], 1):
            bf_str = f"  BF={o['betfair_back']}" if o["betfair_back"] else ""
            line_str = f" ({o['line']})" if o["line"] is not None else ""
            print(
                f"  {i:2d}. [{o['tier']:8s}] {o['away_team']} @ {o['home_team']}"
                f"  |  {o['market']}{line_str}: {o['selection']}"
                f"  |  best={o['best_odds']:.2f} @ {o['best_book']}"
                f"  avg={o['avg_odds']:.2f}  edge={o['edge_pct']:.1f}%"
                f"  prob={o['implied_prob']:.1%}{bf_str}"
            )

    if scanner.api_requests_remaining:
        print(f"\n  API requests remaining: {scanner.api_requests_remaining}")
