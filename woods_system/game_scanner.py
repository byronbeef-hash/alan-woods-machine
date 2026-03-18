"""
Woods System — Game-Level Overlay Scanner (Betfair Exchange)

Scans all markets on Betfair Exchange for upcoming games across
multiple sports. Finds value by comparing back/lay spreads,
liquidity depth, and market efficiency.

Uses Betfair API directly — no third-party odds API needed.
"""

from datetime import datetime, timezone, timedelta

from betfair_client import BetfairClient

# ---------------------------------------------------------------------------
# Supported sports: Betfair event type IDs + competition IDs
# ---------------------------------------------------------------------------
SUPPORTED_SPORTS = {
    "basketball_nba": {
        "label": "NBA",
        "event_type": "7522",
        "competition": "10547864",
    },
    "aussierules_afl": {
        "label": "AFL",
        "event_type": "61420",
        "competition": "11897406",
    },
    "soccer_epl": {
        "label": "EPL",
        "event_type": "1",
        "competition": "10932509",
    },
    "americanfootball_nfl": {
        "label": "NFL",
        "event_type": "6423",
        "competition": "12282733",
    },
}

# Minimum spread % to flag a market as interesting
MIN_SPREAD_PCT = 1.0


class GameOverlayScanner:
    """
    Scans Betfair Exchange markets across sports to find overlays.

    For each game/market/selection, examines back/lay prices,
    available liquidity, and spread tightness to identify
    efficient markets worth betting into.
    """

    def __init__(self, hours_ahead: int = 48):
        self.hours_ahead = hours_ahead
        self.bf = BetfairClient()
        self._logged_in = False

    def _ensure_login(self):
        if not self._logged_in:
            self._logged_in = self.bf.login()
        return self._logged_in

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def scan_all_sports(self) -> list[dict]:
        """Scan every supported sport and return all market entries."""
        if not self._ensure_login():
            print("ERROR: Failed to login to Betfair")
            return []

        all_entries = []
        for sport_key, sport_cfg in SUPPORTED_SPORTS.items():
            entries = self.scan_sport(sport_key)
            all_entries.extend(entries)
        return all_entries

    def scan_sport(self, sport_key: str) -> list[dict]:
        """Fetch all upcoming games for a sport and return market data."""
        if not self._ensure_login():
            return []

        sport_cfg = SUPPORTED_SPORTS.get(sport_key)
        if not sport_cfg:
            print(f"  Unknown sport: {sport_key}")
            return []

        label = sport_cfg["label"]
        print(f"\n{'='*60}")
        print(f"Scanning {label} on Betfair Exchange")
        print(f"{'='*60}")

        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(hours=self.hours_ahead)

        # Get events from Betfair
        try:
            filt = {
                "eventTypeIds": [sport_cfg["event_type"]],
                "marketStartTime": {
                    "from": now.isoformat(),
                    "to": cutoff.isoformat(),
                },
            }
            if sport_cfg.get("competition"):
                filt["competitionIds"] = [sport_cfg["competition"]]

            events = self.bf._betting_call("listEvents", {
                "filter": filt,
                "maxResults": "50",
            })
        except Exception as e:
            print(f"  Error fetching {label} events: {e}")
            return []

        if not events:
            print(f"  No upcoming {label} games found")
            return []

        print(f"  Found {len(events)} upcoming games")
        all_entries = []

        for e in events:
            ev = e["event"]
            event_name = ev["name"]
            event_id = ev["id"]
            game_time = ev.get("openDate", "")

            # Parse team names
            home, away = self._parse_teams(event_name)

            # Get all markets for this event
            try:
                markets = self.bf._betting_call("listMarketCatalogue", {
                    "filter": {"eventIds": [event_id]},
                    "maxResults": "30",
                    "marketProjection": ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
                })
            except Exception as ex:
                print(f"  Error fetching markets for {event_name}: {ex}")
                continue

            print(f"  {event_name}: {len(markets)} markets")

            for m in markets:
                market_id = m["marketId"]
                market_name = m["marketName"]

                try:
                    book = self.bf.get_market_prices(market_id)
                except Exception:
                    continue

                for br in book.get("runners", []):
                    runner_name = next(
                        (r["runnerName"] for r in m.get("runners", [])
                         if r["selectionId"] == br["selectionId"]),
                        "Unknown"
                    )
                    selection_id = br["selectionId"]

                    backs = br.get("ex", {}).get("availableToBack", [])
                    lays = br.get("ex", {}).get("availableToLay", [])

                    if not backs:
                        continue

                    back_price = backs[0]["price"]
                    back_size = backs[0]["size"]
                    lay_price = lays[0]["price"] if lays else None
                    lay_size = lays[0]["size"] if lays else 0

                    # Skip junk: odds too low, or tiny liquidity
                    if back_price < 1.05 or back_size < 20:
                        continue

                    # Implied probability = 1 / decimal_odds
                    implied_prob = round((1.0 / back_price) * 100, 1)

                    # Edge = back/lay spread as percentage
                    spread_pct = 0.0
                    if lay_price and lay_price > back_price:
                        spread_pct = round(((lay_price - back_price) / back_price) * 100, 1)

                    # Win Expectation (Alan Woods): true_prob * odds
                    # Use lay price as proxy for true probability
                    win_expectation = 0.0
                    if lay_price and lay_price > 1.0:
                        true_prob = 1.0 / lay_price
                        win_expectation = round(true_prob * back_price, 3)

                    # Determine tier based on liquidity and spread
                    if back_size > 500 and spread_pct < 3:
                        tier = "STRONG"
                    elif back_size > 100 and spread_pct < 5:
                        tier = "MODERATE"
                    elif back_size > 50:
                        tier = "MARGINAL"
                    else:
                        continue  # Skip thin/illiquid markets

                    all_entries.append({
                        "sport": sport_key,
                        "sport_label": label,
                        "event_id": event_id,
                        "home_team": home,
                        "away_team": away,
                        "commence_time": game_time,
                        "market": market_name,
                        "selection": runner_name,
                        "selection_id": selection_id,
                        "market_id": market_id,
                        "line": None,
                        "best_odds": back_price,
                        "best_book": "Betfair Exchange",
                        "avg_odds": back_price,
                        "worst_odds": back_price,
                        "edge_pct": spread_pct,
                        "implied_prob": implied_prob,
                        "num_bookmakers": 1,
                        "betfair_back": back_price,
                        "betfair_lay": lay_price,
                        "back_size": back_size,
                        "lay_size": lay_size,
                        "tier": tier,
                    })

        print(f"  => {len(all_entries)} selections across {len(events)} games")
        return all_entries

    def scan_game(self, event_id: str) -> list[dict]:
        """Detailed scan for a single game by Betfair event ID."""
        if not self._ensure_login():
            return []

        try:
            markets = self.bf._betting_call("listMarketCatalogue", {
                "filter": {"eventIds": [event_id]},
                "maxResults": "50",
                "marketProjection": ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
            })
        except Exception as e:
            print(f"  Error: {e}")
            return []

        entries = []
        for m in markets:
            try:
                book = self.bf.get_market_prices(m["marketId"])
            except Exception:
                continue

            for br in book.get("runners", []):
                runner_name = next(
                    (r["runnerName"] for r in m.get("runners", [])
                     if r["selectionId"] == br["selectionId"]),
                    "Unknown"
                )
                backs = br.get("ex", {}).get("availableToBack", [])
                lays = br.get("ex", {}).get("availableToLay", [])

                if not backs:
                    continue

                back_price = backs[0]["price"]
                back_size = backs[0]["size"]
                lay_price = lays[0]["price"] if lays else None

                spread_pct = 0.0
                if lay_price and lay_price > 1.0:
                    spread_pct = round(((lay_price / back_price) - 1) * 100, 2)

                entries.append({
                    "market": m["marketName"],
                    "market_id": m["marketId"],
                    "selection": runner_name,
                    "selection_id": br["selectionId"],
                    "betfair_back": back_price,
                    "betfair_lay": lay_price,
                    "back_size": back_size,
                    "spread_pct": spread_pct,
                    "implied_prob": round(100 / back_price, 1),
                })

        return entries

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_teams(event_name: str) -> tuple[str, str]:
        """Parse Betfair event name into (home, away) teams."""
        for sep in [" @ ", " v ", " vs "]:
            if sep in event_name:
                parts = event_name.split(sep, 1)
                if sep == " @ ":
                    return parts[1].strip(), parts[0].strip()
                else:
                    return parts[0].strip(), parts[1].strip()
        return event_name, ""

    def get_balance(self) -> float:
        """Get current Betfair balance."""
        if not self._ensure_login():
            return 0
        return self.bf.get_balance()


# ======================================================================
# CLI entry point
# ======================================================================

if __name__ == "__main__":
    import uuid
    from database import Database

    print("=" * 60)
    print("  Woods System — Betfair Overlay Scanner")
    print("=" * 60)

    scanner = GameOverlayScanner()
    results = scanner.scan_all_sports()

    if not results:
        print("\nNo data found.")
    else:
        print(f"\n{'='*60}")
        print(f"  {len(results)} selections found")
        print(f"{'='*60}")

        # Show top entries by tier
        strong = [r for r in results if r["tier"] == "STRONG"]
        print(f"\n  STRONG tier: {len(strong)} selections")
        for r in strong[:15]:
            bf_lay = f"/ Lay {r['betfair_lay']}" if r.get("betfair_lay") else ""
            print(
                f"    {r['selection']:35s} Back {r['betfair_back']:<6} {bf_lay}"
                f"  | ${r.get('back_size',0):>6,.0f} avail"
                f"  | {r['market']:20s}"
                f"  | {r['away_team']} @ {r['home_team']}"
                f"  | {r['sport_label']}"
            )

        # Save to database
        db = Database()
        scan_id = str(uuid.uuid4())[:8]

        try:
            db.client.table("game_overlays").delete().neq("id", 0).execute()
        except Exception:
            pass

        records = []
        for r in results:
            rec = {k: v for k, v in r.items()
                   if k not in ("selection_id", "market_id", "back_size", "lay_size")}
            rec["scan_id"] = scan_id
            records.append(rec)

        inserted = 0
        for i in range(0, len(records), 50):
            batch = records[i:i + 50]
            try:
                res = db.client.table("game_overlays").insert(batch).execute()
                inserted += len(res.data) if res.data else 0
            except Exception as e:
                print(f"  Insert error: {e}")

        print(f"\n  Saved {inserted} rows to game_overlays table")
        print(f"  Balance: ${scanner.get_balance():,.2f} AUD")
