"""
Betfair Exchange API client for the Woods System.
Handles authentication, market search, and bet placement.
"""

import os
import time
import requests
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

BETFAIR_APP_KEY = os.getenv("BETFAIR_APP_KEY", "mbbTzHqsRq5wNoOl")
BETFAIR_USERNAME = os.getenv("BETFAIR_USERNAME", "trdickinson")
BETFAIR_PASSWORD = os.getenv("BETFAIR_PASSWORD", "Beef@123")

LOGIN_URL = "https://identitysso.betfair.com.au/api/login"
BETTING_URL = "https://api.betfair.com.au/exchange/betting/json-rpc/v1"
ACCOUNT_URL = "https://api.betfair.com.au/exchange/account/json-rpc/v1"


class BetfairClient:
    """Client for Betfair Exchange API (Australian endpoint)."""

    def __init__(self):
        self.app_key = BETFAIR_APP_KEY
        self.session_token: Optional[str] = None
        self._token_time: float = 0

    def login(self) -> bool:
        """Authenticate and get session token."""
        try:
            resp = requests.post(LOGIN_URL, headers={
                "Accept": "application/json",
                "X-Application": self.app_key,
            }, data={
                "username": BETFAIR_USERNAME,
                "password": BETFAIR_PASSWORD,
            }, timeout=15)
            result = resp.json()
            if result.get("status") == "SUCCESS":
                self.session_token = result["token"]
                self._token_time = time.time()
                return True
            print(f"[Betfair] Login failed: {result}")
            return False
        except Exception as e:
            print(f"[Betfair] Login error: {e}")
            return False

    def _ensure_session(self):
        """Re-login if session is older than 4 hours."""
        if not self.session_token or (time.time() - self._token_time > 14400):
            self.login()

    def _headers(self) -> dict:
        self._ensure_session()
        return {
            "X-Application": self.app_key,
            "X-Authentication": self.session_token,
            "Content-Type": "application/json",
        }

    def _betting_call(self, method: str, params: dict) -> dict:
        """Make a Betfair Betting API call."""
        payload = {
            "jsonrpc": "2.0",
            "method": f"SportsAPING/v1.0/{method}",
            "params": params,
            "id": 1,
        }
        resp = requests.post(BETTING_URL, headers=self._headers(), json=payload, timeout=15)
        result = resp.json()
        if "error" in result:
            raise Exception(f"Betfair API error: {result['error']}")
        return result.get("result", {})

    def _account_call(self, method: str, params: dict = None) -> dict:
        """Make a Betfair Account API call."""
        payload = {
            "jsonrpc": "2.0",
            "method": f"AccountAPING/v1.0/{method}",
            "params": params or {},
            "id": 1,
        }
        resp = requests.post(ACCOUNT_URL, headers=self._headers(), json=payload, timeout=15)
        result = resp.json()
        if "error" in result:
            raise Exception(f"Betfair API error: {result['error']}")
        return result.get("result", {})

    def get_balance(self) -> float:
        """Get available balance in AUD."""
        funds = self._account_call("getAccountFunds")
        return funds.get("availableToBetBalance", 0)

    def find_market(self, home_team: str, away_team: str, market_type: str = "MATCH_ODDS") -> Optional[dict]:
        """
        Find a Betfair market for a given game.
        Returns {marketId, runners: [{selectionId, runnerName}]} or None.
        """
        # Search for events matching the teams
        events = self._betting_call("listEvents", {
            "filter": {
                "textQuery": f"{home_team}",
            },
            "maxResults": "10",
        })

        if not events:
            return None

        # Find the event that matches both teams
        target_event = None
        for e in events:
            name = e["event"]["name"].lower()
            if (home_team.lower().split()[-1] in name and
                    away_team.lower().split()[-1] in name):
                target_event = e["event"]
                break

        if not target_event:
            # Try with away team
            events2 = self._betting_call("listEvents", {
                "filter": {"textQuery": away_team},
                "maxResults": "10",
            })
            for e in events2:
                name = e["event"]["name"].lower()
                if (home_team.lower().split()[-1] in name and
                        away_team.lower().split()[-1] in name):
                    target_event = e["event"]
                    break

        if not target_event:
            print(f"[Betfair] No event found for {away_team} @ {home_team}")
            return None

        # Get markets for this event
        markets = self._betting_call("listMarketCatalogue", {
            "filter": {"eventIds": [target_event["id"]]},
            "maxResults": "50",
            "marketProjection": ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
        })

        if not markets:
            return None

        # Find the target market type
        for m in markets:
            if m["marketName"] == "Moneyline" or m["marketName"] == "Match Odds":
                return {
                    "marketId": m["marketId"],
                    "marketName": m["marketName"],
                    "eventName": target_event["name"],
                    "runners": [
                        {"selectionId": r["selectionId"], "runnerName": r["runnerName"]}
                        for r in m.get("runners", [])
                    ],
                }

        # Return first available market if no exact match
        m = markets[0]
        return {
            "marketId": m["marketId"],
            "marketName": m["marketName"],
            "eventName": target_event["name"],
            "runners": [
                {"selectionId": r["selectionId"], "runnerName": r["runnerName"]}
                for r in m.get("runners", [])
            ],
        }

    def get_market_prices(self, market_id: str) -> dict:
        """Get current back/lay prices for a market."""
        books = self._betting_call("listMarketBook", {
            "marketIds": [market_id],
            "priceProjection": {
                "priceData": ["EX_BEST_OFFERS"],
            },
        })
        if not books:
            return {}
        return books[0]

    def place_bet(
        self,
        market_id: str,
        selection_id: int,
        side: str,
        stake: float,
        price: float,
    ) -> dict:
        """
        Place a bet on Betfair Exchange.

        Args:
            market_id: Betfair market ID
            selection_id: Runner selection ID
            side: "BACK" or "LAY"
            stake: Amount in AUD
            price: Decimal odds (e.g. 2.50)

        Returns:
            dict with betId, status, etc.
        """
        result = self._betting_call("placeOrders", {
            "marketId": market_id,
            "instructions": [{
                "selectionId": selection_id,
                "side": side,
                "orderType": "LIMIT",
                "limitOrder": {
                    "size": round(stake, 2),
                    "price": round(price, 2),
                    "persistenceType": "LAPSE",
                },
            }],
        })
        return result

    def place_back_bet(
        self,
        home_team: str,
        away_team: str,
        team_to_back: str,
        stake: float,
    ) -> dict:
        """
        High-level: find the market and place a BACK bet on a team.

        Returns dict with success status and details.
        """
        # Find the market
        market = self.find_market(home_team, away_team)
        if not market:
            return {"success": False, "error": f"No market found for {away_team} @ {home_team}"}

        # Find the runner matching the team to back
        runner = None
        for r in market["runners"]:
            if team_to_back.lower().split()[-1] in r["runnerName"].lower():
                runner = r
                break

        if not runner:
            return {"success": False, "error": f"Runner '{team_to_back}' not found in {market['runners']}"}

        # Get current best back price
        book = self.get_market_prices(market["marketId"])
        if not book or not book.get("runners"):
            return {"success": False, "error": "No prices available"}

        best_price = None
        for br in book["runners"]:
            if br["selectionId"] == runner["selectionId"]:
                backs = br.get("ex", {}).get("availableToBack", [])
                if backs:
                    best_price = backs[0]["price"]
                break

        if not best_price:
            return {"success": False, "error": "No back price available"}

        # Place the bet
        result = self.place_bet(
            market_id=market["marketId"],
            selection_id=runner["selectionId"],
            side="BACK",
            stake=stake,
            price=best_price,
        )

        placed = result.get("instructionReports", [{}])[0] if isinstance(result, dict) else {}
        status = result.get("status", placed.get("status", "UNKNOWN"))
        bet_id = placed.get("betId", "")

        return {
            "success": status in ("SUCCESS", "PROCESSED"),
            "status": status,
            "betId": bet_id,
            "marketId": market["marketId"],
            "selectionId": runner["selectionId"],
            "runnerName": runner["runnerName"],
            "price": best_price,
            "stake": stake,
            "eventName": market["eventName"],
            "error": placed.get("errorCode", "") if status != "SUCCESS" else "",
        }
