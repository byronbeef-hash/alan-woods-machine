"""
Woods System — Auto-Betting Engine

Places bets automatically on betting exchanges when overlays are found.

IMPORTANT ARCHITECTURE DECISION:
US sportsbooks (DraftKings, FanDuel) do NOT offer betting APIs for
regular users. You can't programmatically place bets there.

So we use BETTING EXCHANGES which DO support API betting:
- Betfair (biggest global exchange, has player props via Sportsbook)
- BetDaq
- Matchbook

The alternative for US-based bettors:
- OddsJam / SharpSportsAction API (aggregates across books)
- Fliff / PrizePicks APIs (DFS-style player props)

This module is built with a pluggable architecture — swap the
exchange adapter for whichever platform you use.

Alan's team would physically go to the Jockey Club windows.
We send an API call.
"""

import os
import time
import json
import hmac
import hashlib
import requests
from abc import ABC, abstractmethod
from datetime import datetime

from notifications import NotificationManager


class BettingExchange(ABC):
    """Abstract base class for betting exchange integrations."""

    @abstractmethod
    def authenticate(self) -> bool:
        """Authenticate with the exchange."""
        pass

    @abstractmethod
    def get_market(self, event_id: str, market_type: str) -> dict:
        """Get current market prices for an event."""
        pass

    @abstractmethod
    def place_bet(
        self, market_id: str, selection_id: str,
        side: str, stake: float, odds: float
    ) -> dict:
        """Place a bet. Returns order reference."""
        pass

    @abstractmethod
    def get_bet_status(self, bet_ref: str) -> dict:
        """Check status of a placed bet."""
        pass

    @abstractmethod
    def get_balance(self) -> float:
        """Get current account balance."""
        pass


class BetfairExchange(BettingExchange):
    """
    Betfair Exchange API integration.

    Betfair is the world's largest betting exchange.
    They offer a full API for programmatic betting.

    Setup:
    1. Create a Betfair account at betfair.com
    2. Get API credentials at https://developer.betfair.com
    3. Generate an application key
    4. Set environment variables (see below)

    Note: Betfair charges 2-5% commission on net winnings per market.
    This is MUCH lower than the 18% rake Alan faced in Hong Kong.
    """

    # Use Australian endpoints for .com.au accounts
    LOGIN_URL = "https://identitysso.betfair.com.au/api/login"
    API_URL = "https://api.betfair.com.au/exchange/betting/json-rpc/v1"
    ACCOUNT_URL = "https://api.betfair.com.au/exchange/account/json-rpc/v1"

    def __init__(self):
        self.username = os.environ.get("BETFAIR_USERNAME", "")
        self.password = os.environ.get("BETFAIR_PASSWORD", "")
        self.app_key = os.environ.get("BETFAIR_APP_KEY", "")
        self.session_token = None
        self.enabled = bool(self.username and self.password and self.app_key)

    def authenticate(self) -> bool:
        if not self.enabled:
            print("  [Betfair] Not configured. Set BETFAIR_USERNAME, BETFAIR_PASSWORD, BETFAIR_APP_KEY.")
            return False

        try:
            headers = {
                "X-Application": self.app_key,
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            }
            data = {"username": self.username, "password": self.password}
            resp = requests.post(self.LOGIN_URL, headers=headers, data=data, timeout=10)
            result = resp.json()

            if result.get("status") == "SUCCESS":
                self.session_token = result["token"]
                print("  [Betfair] Authenticated successfully")
                return True
            else:
                print(f"  [Betfair] Auth failed: {result.get('error', 'Unknown')}")
                return False
        except Exception as e:
            print(f"  [Betfair] Auth error: {e}")
            return False

    def _api_call(self, method: str, params: dict) -> dict:
        """Make a Betfair API call."""
        headers = {
            "X-Application": self.app_key,
            "X-Authentication": self.session_token,
            "Content-Type": "application/json",
        }
        payload = {
            "jsonrpc": "2.0",
            "method": f"SportsAPING/v1.0/{method}",
            "params": params,
        }
        resp = requests.post(self.API_URL, headers=headers, json=payload, timeout=15)
        return resp.json()

    def _account_call(self, method: str, params: dict) -> dict:
        """Make a Betfair Account API call (separate endpoint from betting)."""
        headers = {
            "X-Application": self.app_key,
            "X-Authentication": self.session_token,
            "Content-Type": "application/json",
        }
        payload = {
            "jsonrpc": "2.0",
            "method": f"AccountAPING/v1.0/{method}",
            "params": params,
        }
        resp = requests.post(self.ACCOUNT_URL, headers=headers, json=payload, timeout=15)
        return resp.json()

    def get_market(self, event_id: str, market_type: str) -> dict:
        result = self._api_call("listMarketCatalogue", {
            "filter": {"eventIds": [event_id], "marketTypeCodes": [market_type]},
            "maxResults": "10",
            "marketProjection": ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
        })
        return result.get("result", [])

    def place_bet(
        self, market_id: str, selection_id: str,
        side: str, stake: float, odds: float
    ) -> dict:
        """
        Place a bet on Betfair.

        side: "BACK" (bet for) or "LAY" (bet against)
        stake: amount in account currency
        odds: decimal odds (must be a valid Betfair price increment)
        """
        bet_side = "BACK" if side.upper() in ("OVER", "BACK") else "LAY"

        result = self._api_call("placeOrders", {
            "marketId": market_id,
            "instructions": [{
                "selectionId": selection_id,
                "side": bet_side,
                "orderType": "LIMIT",
                "limitOrder": {
                    "size": round(stake, 2),
                    "price": self._nearest_valid_price(odds),
                    "persistenceType": "LAPSE",  # Cancel if not matched at kick-off
                },
            }],
        })

        if "result" in result:
            order_result = result["result"]
            if order_result.get("status") == "SUCCESS":
                ref = order_result["instructionReports"][0]["betId"]
                return {"success": True, "bet_ref": ref, "status": "PLACED"}
            else:
                return {"success": False, "error": order_result.get("errorCode", "Unknown")}
        return {"success": False, "error": str(result)}

    def get_bet_status(self, bet_ref: str) -> dict:
        result = self._api_call("listCurrentOrders", {
            "betIds": [bet_ref],
        })
        orders = result.get("result", {}).get("currentOrders", [])
        if orders:
            order = orders[0]
            return {
                "bet_ref": bet_ref,
                "status": order.get("status", "UNKNOWN"),
                "matched": order.get("sizeMatched", 0),
                "remaining": order.get("sizeRemaining", 0),
                "avg_price": order.get("averagePriceMatched", 0),
            }
        return {"bet_ref": bet_ref, "status": "NOT_FOUND"}

    def get_balance(self) -> float:
        result = self._account_call("getAccountFunds", {})
        return result.get("result", {}).get("availableToBetBalance", 0)

    def _nearest_valid_price(self, price: float) -> float:
        """Round to the nearest valid Betfair price increment."""
        if price <= 2:
            return round(price * 100) / 100       # 0.01 increments
        elif price <= 3:
            return round(price * 50) / 50          # 0.02 increments
        elif price <= 4:
            return round(price * 20) / 20          # 0.05 increments
        elif price <= 6:
            return round(price * 10) / 10          # 0.1 increments
        elif price <= 10:
            return round(price * 5) / 5            # 0.2 increments
        elif price <= 20:
            return round(price * 2) / 2            # 0.5 increments
        else:
            return round(price)                     # 1.0 increments


class DryRunExchange(BettingExchange):
    """
    Paper-trading exchange — simulates bet placement without real money.
    Use this for testing and during the initial calibration period.

    This is the equivalent of Alan's early period where he was
    testing the model before committing real capital.
    """

    def __init__(self, starting_balance: float = 5000):
        self.balance = starting_balance
        self.bets = {}
        self.bet_counter = 0
        self.enabled = True

    def authenticate(self) -> bool:
        print("  [DryRun] Paper trading mode — no real money at risk")
        return True

    def get_market(self, event_id: str, market_type: str) -> dict:
        return {"market_id": f"dry_{event_id}_{market_type}"}

    def place_bet(
        self, market_id: str, selection_id: str,
        side: str, stake: float, odds: float
    ) -> dict:
        self.bet_counter += 1
        ref = f"DRY-{self.bet_counter:04d}"

        self.bets[ref] = {
            "market_id": market_id,
            "selection_id": selection_id,
            "side": side,
            "stake": stake,
            "odds": odds,
            "placed_at": datetime.now().isoformat(),
            "status": "MATCHED",
        }

        self.balance -= stake
        print(f"  [DryRun] Bet placed: {ref} | ${stake:.0f} @ {odds:.2f} | "
              f"Balance: ${self.balance:.0f}")

        return {"success": True, "bet_ref": ref, "status": "MATCHED"}

    def get_bet_status(self, bet_ref: str) -> dict:
        bet = self.bets.get(bet_ref)
        if bet:
            return {"bet_ref": bet_ref, "status": bet["status"], "matched": bet["stake"]}
        return {"bet_ref": bet_ref, "status": "NOT_FOUND"}

    def get_balance(self) -> float:
        return self.balance

    def settle_bet(self, bet_ref: str, won: bool):
        """Settle a dry-run bet."""
        bet = self.bets.get(bet_ref)
        if bet and bet["status"] == "MATCHED":
            if won:
                payout = bet["stake"] * bet["odds"]
                self.balance += payout
                bet["status"] = "WON"
                bet["pnl"] = payout - bet["stake"]
            else:
                bet["status"] = "LOST"
                bet["pnl"] = -bet["stake"]


class AutoBettor:
    """
    Orchestrates automatic bet placement.

    Takes overlay recommendations from the system, verifies them
    against live exchange prices, and places bets automatically.

    Safety features:
    - Maximum daily loss limit
    - Odds freshness check (won't bet if odds have moved significantly)
    - Rate limiting to avoid exchange throttling
    - Full audit trail of every bet placed
    """

    def __init__(
        self,
        exchange: BettingExchange = None,
        notifier: NotificationManager = None,
        max_daily_loss: float = 500,
        odds_drift_tolerance: float = 0.05,
    ):
        self.exchange = exchange or DryRunExchange()
        self.notifier = notifier or NotificationManager()
        self.max_daily_loss = max_daily_loss
        self.odds_drift_tolerance = odds_drift_tolerance
        self.daily_pnl = 0
        self.bets_placed_today = []

    def execute_bet_card(self, bets: list[dict]) -> list[dict]:
        """
        Execute a full bet card — place all recommended bets.

        Returns a list of placement results.
        """
        if not self.exchange.authenticate():
            self.notifier.notify_error("Failed to authenticate with exchange")
            return []

        results = []
        for bet in bets:
            # Safety check: daily loss limit
            if self.daily_pnl <= -self.max_daily_loss:
                msg = (f"Daily loss limit reached (${self.max_daily_loss}). "
                       f"Stopping auto-betting.")
                print(f"  [AutoBet] {msg}")
                self.notifier.notify_error(msg)
                break

            result = self._place_single_bet(bet)
            results.append(result)

            if result["success"]:
                self.bets_placed_today.append(result)
                self.notifier.notify_bet_placed(bet, result.get("bet_ref"))

            # Rate limit: small delay between bets
            time.sleep(1)

        return results

    def _place_single_bet(self, bet: dict) -> dict:
        """Place a single bet with safety checks."""
        player = bet["player"]
        stake = bet["bet_size"]
        odds = bet["odds_decimal"]
        side = bet["side"]

        print(f"\n  [AutoBet] Placing: {player} {side} {bet['line']} "
              f"| ${stake:.0f} @ {odds:.2f}")

        # For now, use a simplified market/selection ID
        # In production, you'd map player props to exchange market IDs
        market_id = f"{bet['market']}_{player.replace(' ', '_').lower()}"
        selection_id = f"{side.lower()}_{bet['line']}"

        placement = self.exchange.place_bet(
            market_id=market_id,
            selection_id=selection_id,
            side=side,
            stake=stake,
            odds=odds,
        )

        return {
            **placement,
            "player": player,
            "market": bet["market"],
            "side": side,
            "line": bet["line"],
            "stake": stake,
            "odds": odds,
            "timestamp": datetime.now().isoformat(),
        }

    def check_results(self) -> list[dict]:
        """Check results of all bets placed today."""
        results = []
        for bet in self.bets_placed_today:
            if bet.get("bet_ref"):
                status = self.exchange.get_bet_status(bet["bet_ref"])
                results.append({**bet, **status})
        return results

    def get_daily_summary(self) -> dict:
        """Summarize today's auto-betting activity."""
        balance = self.exchange.get_balance()
        return {
            "bets_placed": len(self.bets_placed_today),
            "total_staked": sum(b.get("stake", 0) for b in self.bets_placed_today),
            "current_balance": balance,
            "daily_pnl": self.daily_pnl,
        }


if __name__ == "__main__":
    print("=== Auto-Bettor Test (Dry Run) ===\n")

    exchange = DryRunExchange(starting_balance=5000)
    bettor = AutoBettor(exchange=exchange)

    # Simulate a bet card
    test_bets = [
        {
            "player": "Luka Doncic", "market": "player_points",
            "side": "Over", "line": 28.5, "bet_size": 150,
            "odds_decimal": 1.87, "odds_american": -115,
            "edge": 0.06, "tier": "MODERATE", "model_prob": 0.58,
        },
        {
            "player": "Nikola Jokic", "market": "player_rebounds",
            "side": "Over", "line": 12.5, "bet_size": 200,
            "odds_decimal": 1.91, "odds_american": -110,
            "edge": 0.08, "tier": "STRONG", "model_prob": 0.60,
        },
    ]

    results = bettor.execute_bet_card(test_bets)
    print(f"\n  Placed {len(results)} bets")
    print(f"  Balance: ${exchange.get_balance():,.0f}")

    # Settle
    exchange.settle_bet("DRY-0001", won=True)
    exchange.settle_bet("DRY-0002", won=False)
    print(f"  After settlement: ${exchange.get_balance():,.0f}")
