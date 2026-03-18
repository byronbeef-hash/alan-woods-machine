"""
Woods System — Data Pipeline
Fetches NBA player statistics and live odds from multiple sources.

This is the equivalent of Alan's dozen analysts scattered across Asia,
watching every horse in every race. Except it runs in seconds.
"""

import time
import requests
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

try:
    from nba_api.stats.endpoints import (
        playergamelog,
        leaguegamefinder,
        commonallplayers,
        scoreboardv2,
        playerdashboardbygeneralsplits,
        commonplayerinfo,
        boxscoretraditionalv2,
    )
    from nba_api.stats.static import players as nba_players
    from nba_api.stats.static import teams as nba_teams
    NBA_API_AVAILABLE = True
except ImportError:
    NBA_API_AVAILABLE = False
    print("WARNING: nba_api not installed. Run: pip install nba_api")

import config


class PlayerStatsEngine:
    """
    Fetches and processes NBA player statistics.
    Calculates the features Alan would have tracked: recent form,
    matchup context, home/away splits, rest days, pace adjustments.
    """

    def __init__(self):
        self.player_cache = {}
        self.team_cache = {}

    def get_player_id(self, player_name: str) -> int | None:
        """Look up NBA player ID by name."""
        if not NBA_API_AVAILABLE:
            return None
        matches = nba_players.find_players_by_full_name(player_name)
        if matches:
            return matches[0]["id"]
        # Try partial match
        parts = player_name.lower().split()
        for part in parts:
            matches = nba_players.find_players_by_last_name(part)
            if len(matches) == 1:
                return matches[0]["id"]
        return None

    def get_player_jersey_number(self, player_id: int) -> str | None:
        """Look up a player's jersey number via CommonPlayerInfo."""
        if not NBA_API_AVAILABLE:
            return None

        cache_key = f"jersey_{player_id}"
        if cache_key in self.player_cache:
            return self.player_cache[cache_key]

        try:
            time.sleep(0.6)
            info = commonplayerinfo.CommonPlayerInfo(player_id=player_id)
            df = info.get_data_frames()[0]
            if not df.empty and "JERSEY" in df.columns:
                jersey = str(df.iloc[0]["JERSEY"]) if pd.notna(df.iloc[0]["JERSEY"]) else None
                self.player_cache[cache_key] = jersey
                return jersey
        except Exception as e:
            print(f"Error fetching jersey for player {player_id}: {e}")
        return None

    def get_live_scoreboard(self) -> list[dict]:
        """Fetch today's live scoreboard from NBA API."""
        if not NBA_API_AVAILABLE:
            return []

        try:
            time.sleep(0.6)
            sb = scoreboardv2.ScoreboardV2()
            games_df = sb.get_data_frames()[0]  # GameHeader
            line_score_df = sb.get_data_frames()[1]  # LineScore

            games = []
            for _, game in games_df.iterrows():
                game_id = game["GAME_ID"]
                status = game.get("GAME_STATUS_TEXT", "")
                home_id = game.get("HOME_TEAM_ID")
                away_id = game.get("VISITOR_TEAM_ID")

                # Get scores from LineScore
                home_score = 0
                away_score = 0
                for _, ls in line_score_df[line_score_df["GAME_ID"] == game_id].iterrows():
                    if ls["TEAM_ID"] == home_id:
                        home_score = int(ls.get("PTS", 0) or 0)
                    elif ls["TEAM_ID"] == away_id:
                        away_score = int(ls.get("PTS", 0) or 0)

                # Map NBA API status to our game_status values
                game_status_id = game.get("GAME_STATUS_ID", 1)
                if game_status_id == 1:
                    game_status = "SCHEDULED"
                elif game_status_id == 3:
                    game_status = "FINAL"
                else:
                    # Live — parse period from LIVE_PERIOD
                    period = game.get("LIVE_PERIOD", 1)
                    clock = game.get("LIVE_PC_TIME", "")
                    if period <= 4:
                        game_status = f"LIVE_Q{period}"
                    else:
                        game_status = "LIVE_OT"

                games.append({
                    "game_id": game_id,
                    "game_status": game_status,
                    "game_clock": status.strip(),
                    "home_team_id": home_id,
                    "away_team_id": away_id,
                    "home_team": game.get("HOME_TEAM_NAME", ""),
                    "away_team": game.get("VISITOR_TEAM_NAME", ""),
                    "home_score": home_score,
                    "away_score": away_score,
                })
            return games
        except Exception as e:
            print(f"Error fetching scoreboard: {e}")
            return []

    def get_player_box_score(self, game_id: str, player_name: str) -> dict | None:
        """Get a player's current in-game box score stats."""
        if not NBA_API_AVAILABLE:
            return None

        try:
            time.sleep(0.6)
            box = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
            players_df = box.get_data_frames()[0]

            for _, row in players_df.iterrows():
                full_name = row.get("PLAYER_NAME", "")
                if full_name.lower() == player_name.lower():
                    return {
                        "player": full_name,
                        "minutes": row.get("MIN", "0"),
                        "pts": int(row.get("PTS", 0) or 0),
                        "reb": int(row.get("REB", 0) or 0),
                        "ast": int(row.get("AST", 0) or 0),
                        "fg3m": int(row.get("FG3M", 0) or 0),
                    }
            return None
        except Exception as e:
            print(f"Error fetching box score for {player_name}: {e}")
            return None

    def get_player_game_log(self, player_id: int, season: str = None) -> pd.DataFrame:
        """
        Fetch a player's game-by-game stats for the season.
        This is the raw data that feeds the model — equivalent to
        Alan's per-race horse data.
        """
        if not NBA_API_AVAILABLE:
            return pd.DataFrame()

        season = season or config.NBA_SEASON
        cache_key = f"{player_id}_{season}"

        if cache_key in self.player_cache:
            return self.player_cache[cache_key]

        try:
            time.sleep(0.6)  # Respect NBA API rate limits
            log = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                season_type_all_star="Regular Season",
            )
            df = log.get_data_frames()[0]

            if df.empty:
                return df

            # Parse and enrich the data
            df["GAME_DATE"] = pd.to_datetime(df["GAME_DATE"])
            df = df.sort_values("GAME_DATE").reset_index(drop=True)

            # Add derived features
            df["HOME"] = df["MATCHUP"].apply(lambda x: 1 if "vs." in x else 0)
            df["OPPONENT"] = df["MATCHUP"].apply(
                lambda x: x.split("vs. ")[-1] if "vs." in x else x.split("@ ")[-1]
            )
            df["REST_DAYS"] = df["GAME_DATE"].diff().dt.days.fillna(3)
            df["GAME_NUMBER"] = range(1, len(df) + 1)

            # Rolling averages (Alan's "recent form" equivalent)
            for stat in ["PTS", "REB", "AST", "FG3M", "MIN"]:
                df[f"{stat}_ROLL5"] = df[stat].rolling(5, min_periods=1).mean()
                df[f"{stat}_ROLL10"] = df[stat].rolling(10, min_periods=1).mean()
                df[f"{stat}_STD5"] = df[stat].rolling(5, min_periods=2).std()

            self.player_cache[cache_key] = df
            return df

        except Exception as e:
            print(f"Error fetching game log for player {player_id}: {e}")
            return pd.DataFrame()

    def compute_player_profile(self, player_id: int) -> dict | None:
        """
        Build a complete statistical profile for a player.
        This is what Alan's analysts compiled for every horse:
        a comprehensive view of form, tendencies, and context.
        """
        df = self.get_player_game_log(player_id)
        if df.empty or len(df) < config.MIN_GAMES_PLAYED:
            return None

        recent = df.tail(config.LOOKBACK_GAMES)
        season = df

        profile = {"player_id": player_id, "games_played": len(df)}

        for stat in ["PTS", "REB", "AST", "FG3M", "MIN"]:
            # Weighted average: recent form weighted more heavily (Alan's key insight)
            season_avg = season[stat].mean()
            recent_avg = recent[stat].mean()
            weighted_avg = (
                config.SEASON_WEIGHT * season_avg
                + config.RECENT_WEIGHT * recent_avg
            )

            profile[f"{stat}_season_avg"] = round(season_avg, 2)
            profile[f"{stat}_recent_avg"] = round(recent_avg, 2)
            profile[f"{stat}_weighted_avg"] = round(weighted_avg, 2)
            profile[f"{stat}_std"] = round(season[stat].std(), 2)
            profile[f"{stat}_median"] = round(season[stat].median(), 2)

            # Over/under rates at common lines
            for line in _common_lines(stat):
                over_rate = (season[stat] > line).mean()
                recent_over_rate = (recent[stat] > line).mean()
                weighted_rate = (
                    config.SEASON_WEIGHT * over_rate
                    + config.RECENT_WEIGHT * recent_over_rate
                )
                profile[f"{stat}_over_{line}"] = round(weighted_rate, 4)

            # Home/away splits
            home_games = season[season["HOME"] == 1]
            away_games = season[season["HOME"] == 0]
            if len(home_games) > 3:
                profile[f"{stat}_home_avg"] = round(home_games[stat].mean(), 2)
            if len(away_games) > 3:
                profile[f"{stat}_away_avg"] = round(away_games[stat].mean(), 2)

            # Rest day impact
            rested = season[season["REST_DAYS"] >= 2]
            back2back = season[season["REST_DAYS"] <= 1]
            if len(rested) > 3:
                profile[f"{stat}_rested_avg"] = round(rested[stat].mean(), 2)
            if len(back2back) > 3:
                profile[f"{stat}_b2b_avg"] = round(back2back[stat].mean(), 2)

        # Trend detection: is the player trending up or down?
        if len(df) >= 10:
            last10 = df.tail(10)
            first_half = last10.head(5)["PTS"].mean()
            second_half = last10.tail(5)["PTS"].mean()
            profile["pts_trend"] = round(second_half - first_half, 2)

        return profile


class OddsEngine:
    """
    Fetches live player prop odds from The Odds API.
    This is the equivalent of Alan checking the tote board —
    what the public thinks vs. what our model thinks.
    """

    BASE_URL = "https://api.the-odds-api.com/v4"

    def __init__(self, api_key: str = None):
        self.api_key = api_key or config.ODDS_API_KEY

    def get_upcoming_games(self, sport_key: str = None) -> list[dict]:
        """Fetch upcoming games with odds for a given sport."""
        sport = sport_key or config.SPORT_KEY
        if self.api_key == "YOUR_API_KEY_HERE":
            print("NOTE: Set your Odds API key in config.py to fetch live odds.")
            print("      Get a free key at https://the-odds-api.com")
            return self._demo_games()

        try:
            url = f"{self.BASE_URL}/sports/{sport}/odds/"
            params = {
                "apiKey": self.api_key,
                "regions": "us",
                "markets": "h2h,spreads,totals",
                "oddsFormat": "american",
            }
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"Error fetching game odds: {e}")
            return []

    def get_player_props(self, event_id: str, market: str = "player_points", sport_key: str = None) -> list[dict]:
        """
        Fetch player prop odds for a specific game.
        Returns lines like: Doncic Over 28.5 Points at -110
        """
        sport = sport_key or config.SPORT_KEY
        if self.api_key == "YOUR_API_KEY_HERE":
            return self._demo_props(market)

        try:
            url = f"{self.BASE_URL}/sports/{sport}/events/{event_id}/odds"
            params = {
                "apiKey": self.api_key,
                "regions": "us",
                "markets": market,
                "oddsFormat": "american",
            }
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            return self._parse_props(data, market)
        except Exception as e:
            print(f"Error fetching props: {e}")
            return []

    def _parse_props(self, data: dict, market: str) -> list[dict]:
        """Parse raw API response into clean prop lines."""
        props = []
        for bookmaker in data.get("bookmakers", []):
            for mkt in bookmaker.get("markets", []):
                if mkt["key"] == market:
                    for outcome in mkt["outcomes"]:
                        props.append({
                            "book": bookmaker["key"],
                            "player": outcome.get("description", ""),
                            "market": market,
                            "side": outcome["name"],  # Over or Under
                            "line": outcome.get("point", 0),
                            "odds_american": outcome["price"],
                            "odds_decimal": american_to_decimal(outcome["price"]),
                            "implied_prob": american_to_probability(outcome["price"]),
                        })
        return props

    def _demo_games(self) -> list[dict]:
        """Demo data for testing without an API key."""
        return [
            {
                "id": "demo_game_1",
                "home_team": "Dallas Mavericks",
                "away_team": "Los Angeles Lakers",
                "commence_time": datetime.now().isoformat(),
            },
            {
                "id": "demo_game_2",
                "home_team": "Boston Celtics",
                "away_team": "Denver Nuggets",
                "commence_time": datetime.now().isoformat(),
            },
        ]

    def _demo_props(self, market: str) -> list[dict]:
        """Demo prop lines for testing without an API key."""
        demo_data = {
            "player_points": [
                {"player": "Luka Doncic", "line": 28.5, "over_odds": -115, "under_odds": -105},
                {"player": "LeBron James", "line": 25.5, "over_odds": -110, "under_odds": -110},
                {"player": "Jayson Tatum", "line": 27.5, "over_odds": +100, "under_odds": -120},
                {"player": "Nikola Jokic", "line": 26.5, "over_odds": -105, "under_odds": -115},
                {"player": "Anthony Edwards", "line": 24.5, "over_odds": -110, "under_odds": -110},
                {"player": "Shai Gilgeous-Alexander", "line": 31.5, "over_odds": -105, "under_odds": -115},
            ],
            "player_rebounds": [
                {"player": "Nikola Jokic", "line": 12.5, "over_odds": -110, "under_odds": -110},
                {"player": "Luka Doncic", "line": 8.5, "over_odds": -115, "under_odds": -105},
                {"player": "LeBron James", "line": 7.5, "over_odds": -105, "under_odds": -115},
            ],
            "player_assists": [
                {"player": "Nikola Jokic", "line": 9.5, "over_odds": +100, "under_odds": -120},
                {"player": "Luka Doncic", "line": 8.5, "over_odds": -110, "under_odds": -110},
                {"player": "LeBron James", "line": 7.5, "over_odds": -115, "under_odds": -105},
            ],
            "player_threes": [
                {"player": "Luka Doncic", "line": 3.5, "over_odds": +110, "under_odds": -130},
                {"player": "Jayson Tatum", "line": 2.5, "over_odds": -130, "under_odds": +110},
            ],
        }

        props = []
        for entry in demo_data.get(market, []):
            for side, odds_key in [("Over", "over_odds"), ("Under", "under_odds")]:
                odds = entry[odds_key]
                props.append({
                    "book": "demo",
                    "player": entry["player"],
                    "market": market,
                    "side": side,
                    "line": entry["line"],
                    "odds_american": odds,
                    "odds_decimal": american_to_decimal(odds),
                    "implied_prob": american_to_probability(odds),
                })
        return props


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def american_to_decimal(american: int) -> float:
    """Convert American odds to decimal odds."""
    if american > 0:
        return 1 + (american / 100)
    else:
        return 1 + (100 / abs(american))


def american_to_probability(american: int) -> float:
    """Convert American odds to implied probability (includes vig)."""
    if american > 0:
        return 100 / (american + 100)
    else:
        return abs(american) / (abs(american) + 100)


def decimal_to_probability(decimal_odds: float) -> float:
    """Convert decimal odds to implied probability."""
    return 1 / decimal_odds


def _common_lines(stat: str) -> list[float]:
    """Common betting lines for each stat type."""
    lines = {
        "PTS": [15.5, 18.5, 20.5, 22.5, 24.5, 26.5, 28.5, 30.5, 32.5],
        "REB": [4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
        "AST": [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5],
        "FG3M": [1.5, 2.5, 3.5, 4.5, 5.5],
        "MIN": [25.5, 28.5, 30.5, 32.5, 34.5, 36.5],
    }
    return lines.get(stat, [])


if __name__ == "__main__":
    # Quick test
    print("=== Woods System — Data Pipeline Test ===\n")

    odds = OddsEngine()
    games = odds.get_upcoming_games()
    print(f"Found {len(games)} upcoming games")

    props = odds.get_player_props("demo", "player_points")
    print(f"Found {len(props)} player point props\n")

    for p in props[:6]:
        print(f"  {p['player']} {p['side']} {p['line']} @ {p['odds_american']:+d} "
              f"(implied: {p['implied_prob']:.1%})")

    if NBA_API_AVAILABLE:
        print("\n--- Testing NBA Stats ---")
        stats = PlayerStatsEngine()
        pid = stats.get_player_id("Luka Doncic")
        if pid:
            profile = stats.compute_player_profile(pid)
            if profile:
                print(f"\nLuka Doncic profile:")
                print(f"  Games played: {profile['games_played']}")
                print(f"  PTS weighted avg: {profile['PTS_weighted_avg']}")
                print(f"  PTS recent avg:   {profile['PTS_recent_avg']}")
                print(f"  PTS std dev:      {profile['PTS_std']}")
