"""
Woods System — Prediction Model
Calculates independent probabilities for player prop outcomes.

This is the heart of the system — Alan's equivalent was the formula
that assigned coefficients to every factor affecting a horse's chance.
Our model does the same for NBA players.

The key insight (from Alan): we don't need to predict exact stat lines.
We need to estimate the PROBABILITY that a player goes over or under
a given line. Then we compare that to what the market implies.
"""

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats
from typing import Optional

import config
from data_pipeline import PlayerStatsEngine


class PropModel:
    """
    Estimates the probability of a player going over/under a stat line.

    Uses a distribution-based approach:
    1. Estimate the player's expected output (mean) and variance
    2. Adjust for context (home/away, rest, opponent, trend)
    3. Fit a distribution to the adjusted parameters
    4. Calculate P(stat > line) from the distribution

    This is more principled than a simple "he averaged 28 so he'll
    probably go over 27.5" — it accounts for the SHAPE of the
    distribution, which is where the real edge lives.
    """

    # Stat type to distribution mapping
    # Points are roughly normal; threes are Poisson-like
    STAT_MAP = {
        "player_points": "PTS",
        "player_rebounds": "REB",
        "player_assists": "AST",
        "player_threes": "FG3M",
    }

    def __init__(self):
        self.stats_engine = PlayerStatsEngine()

    def predict_over_probability(
        self,
        player_name: str,
        market: str,
        line: float,
        is_home: bool = True,
        rest_days: int = 2,
        opponent: str = None,
    ) -> dict | None:
        """
        Calculate the probability of a player going over a line.

        Returns a dict with:
        - model_prob: our estimated probability of the over
        - model_under_prob: our estimated probability of the under
        - expected_value: adjusted mean prediction
        - confidence: how confident we are in the estimate (0-1)
        - factors: breakdown of adjustment factors applied

        This is Alan's three-decimal-place probability for each horse,
        applied to NBA player props.
        """
        stat_key = self.STAT_MAP.get(market)
        if not stat_key:
            return None

        # Get player data
        player_id = self.stats_engine.get_player_id(player_name)
        if player_id is None:
            # Fall back to demo mode
            return self._demo_prediction(player_name, market, line, is_home, rest_days)

        profile = self.stats_engine.compute_player_profile(player_id)
        if profile is None:
            return self._demo_prediction(player_name, market, line, is_home, rest_days)

        game_log = self.stats_engine.get_player_game_log(player_id)

        # --- Step 1: Base estimate ---
        base_mean = profile[f"{stat_key}_weighted_avg"]
        base_std = profile[f"{stat_key}_std"]

        # Ensure reasonable std (floor at 15% of mean to avoid overconfidence)
        base_std = max(base_std, base_mean * 0.15, 1.0)

        # --- Step 2: Contextual adjustments ---
        # These are Alan's "coefficients" — each factor nudges the prediction
        adjustments = {}
        adjusted_mean = base_mean

        # Home/away adjustment
        home_key = f"{stat_key}_home_avg"
        away_key = f"{stat_key}_away_avg"
        if is_home and home_key in profile:
            home_diff = profile[home_key] - profile[f"{stat_key}_season_avg"]
            adjusted_mean += home_diff * 0.5  # Partial adjustment (regression to mean)
            adjustments["home_court"] = round(home_diff * 0.5, 2)
        elif not is_home and away_key in profile:
            away_diff = profile[away_key] - profile[f"{stat_key}_season_avg"]
            adjusted_mean += away_diff * 0.5
            adjustments["away"] = round(away_diff * 0.5, 2)

        # Rest day adjustment
        if rest_days <= 1:
            b2b_key = f"{stat_key}_b2b_avg"
            if b2b_key in profile:
                b2b_diff = profile[b2b_key] - profile[f"{stat_key}_season_avg"]
                adjusted_mean += b2b_diff * 0.4
                adjustments["back_to_back"] = round(b2b_diff * 0.4, 2)
            else:
                # Default: slight negative impact for back-to-backs
                adjusted_mean *= 0.97
                adjustments["back_to_back"] = round(base_mean * -0.03, 2)
        elif rest_days >= 3:
            rested_key = f"{stat_key}_rested_avg"
            if rested_key in profile:
                rest_diff = profile[rested_key] - profile[f"{stat_key}_season_avg"]
                adjusted_mean += rest_diff * 0.3
                adjustments["well_rested"] = round(rest_diff * 0.3, 2)

        # Trend adjustment (is the player getting hotter or colder?)
        if "pts_trend" in profile and stat_key == "PTS":
            trend = profile["pts_trend"]
            adjusted_mean += trend * 0.2  # Partial trend following
            adjustments["trend"] = round(trend * 0.2, 2)

        # --- Step 3: Fit distribution and calculate probability ---
        # Use Gaussian for points/rebounds, Poisson-ish for threes
        if stat_key == "FG3M":
            # For threes: use actual game-by-game data to estimate
            # the empirical over rate, blended with Poisson
            actual_values = game_log[stat_key].values
            empirical_over = np.mean(actual_values > line)

            # Poisson approximation
            poisson_over = 1 - scipy_stats.poisson.cdf(int(line), adjusted_mean)

            # Blend empirical and parametric (more data = trust empirical more)
            n_games = len(actual_values)
            empirical_weight = min(n_games / 50, 0.7)
            model_prob = empirical_weight * empirical_over + (1 - empirical_weight) * poisson_over
        else:
            # Gaussian model for points, rebounds, assists
            # P(X > line) where X ~ Normal(adjusted_mean, base_std)
            # Use line + 0.5 for the "push" adjustment (over means strictly over)
            z_score = (line + 0.5 - adjusted_mean) / base_std
            model_prob = 1 - scipy_stats.norm.cdf(z_score)

            # Blend with empirical rate from game log
            actual_values = game_log[stat_key].values
            empirical_over = np.mean(actual_values > line)
            n_games = len(actual_values)
            empirical_weight = min(n_games / 60, 0.5)
            model_prob = empirical_weight * empirical_over + (1 - empirical_weight) * model_prob

        # Clamp to reasonable range (never say 0% or 100%)
        model_prob = np.clip(model_prob, 0.02, 0.98)

        # --- Step 4: Confidence estimation ---
        # Higher confidence with more games, lower std, and consistent trends
        games_factor = min(profile["games_played"] / 40, 1.0)
        consistency_factor = 1 - min(base_std / (base_mean + 1), 0.5)
        confidence = round(games_factor * 0.6 + consistency_factor * 0.4, 3)

        return {
            "player": player_name,
            "market": market,
            "stat": stat_key,
            "line": line,
            "model_prob_over": round(model_prob, 4),
            "model_prob_under": round(1 - model_prob, 4),
            "expected_value": round(adjusted_mean, 2),
            "base_mean": round(base_mean, 2),
            "std_dev": round(base_std, 2),
            "confidence": confidence,
            "games_sampled": profile["games_played"],
            "adjustments": adjustments,
        }

    def _demo_prediction(
        self, player_name: str, market: str, line: float,
        is_home: bool, rest_days: int
    ) -> dict:
        """
        Demo prediction using reasonable estimates when NBA API isn't available.
        Uses known player averages to produce realistic outputs.
        """
        stat_key = self.STAT_MAP.get(market, "PTS")

        # Approximate known player averages (2024-25 style)
        known_players = {
            "Luka Doncic":                  {"PTS": 28.5, "REB": 8.8, "AST": 8.2, "FG3M": 3.1},
            "LeBron James":                 {"PTS": 25.0, "REB": 7.5, "AST": 7.8, "FG3M": 2.1},
            "Jayson Tatum":                 {"PTS": 27.0, "REB": 8.5, "AST": 4.5, "FG3M": 2.8},
            "Nikola Jokic":                 {"PTS": 26.5, "REB": 12.3, "AST": 9.5, "FG3M": 1.1},
            "Anthony Edwards":              {"PTS": 25.5, "REB": 5.5, "AST": 5.0, "FG3M": 2.8},
            "Shai Gilgeous-Alexander":      {"PTS": 31.5, "REB": 5.5, "AST": 6.0, "FG3M": 1.8},
        }

        player_stats = known_players.get(player_name, {"PTS": 20, "REB": 5, "AST": 4, "FG3M": 1.5})
        base_mean = player_stats.get(stat_key, 20)

        # Standard deviations (typical NBA variance by stat type)
        std_estimates = {"PTS": 7.5, "REB": 3.2, "AST": 2.8, "FG3M": 1.5}
        base_std = std_estimates.get(stat_key, 4.0)

        adjusted_mean = base_mean
        adjustments = {}

        if is_home:
            adjusted_mean += 0.8
            adjustments["home_court"] = 0.8
        else:
            adjusted_mean -= 0.5
            adjustments["away"] = -0.5

        if rest_days <= 1:
            adjusted_mean *= 0.97
            adjustments["back_to_back"] = round(base_mean * -0.03, 2)

        if stat_key == "FG3M":
            model_prob = 1 - scipy_stats.poisson.cdf(int(line), adjusted_mean)
        else:
            z_score = (line + 0.5 - adjusted_mean) / base_std
            model_prob = 1 - scipy_stats.norm.cdf(z_score)

        model_prob = np.clip(model_prob, 0.02, 0.98)

        return {
            "player": player_name,
            "market": market,
            "stat": stat_key,
            "line": line,
            "model_prob_over": round(float(model_prob), 4),
            "model_prob_under": round(float(1 - model_prob), 4),
            "expected_value": round(float(adjusted_mean), 2),
            "base_mean": round(float(base_mean), 2),
            "std_dev": round(float(base_std), 2),
            "confidence": 0.65,  # Lower confidence for demo estimates
            "games_sampled": 0,
            "adjustments": adjustments,
            "demo_mode": True,
        }

    def batch_predict(self, props: list[dict], is_home_map: dict = None) -> list[dict]:
        """
        Run predictions for a batch of prop lines.
        Returns predictions sorted by edge (strongest overlays first).
        """
        predictions = []
        is_home_map = is_home_map or {}

        for prop in props:
            if prop["side"] != "Over":
                continue  # We'll calculate under from over probability

            pred = self.predict_over_probability(
                player_name=prop["player"],
                market=prop["market"],
                line=prop["line"],
                is_home=is_home_map.get(prop["player"], True),
            )
            if pred:
                # Add the market odds for comparison
                pred["market_implied_over"] = prop["implied_prob"]
                # Find the matching under line
                under_prop = next(
                    (p for p in props
                     if p["player"] == prop["player"]
                     and p["market"] == prop["market"]
                     and p["side"] == "Under"),
                    None
                )
                if under_prop:
                    pred["market_implied_under"] = under_prop["implied_prob"]
                    pred["under_odds_decimal"] = under_prop["odds_decimal"]
                    pred["under_odds_american"] = under_prop["odds_american"]

                pred["over_odds_decimal"] = prop["odds_decimal"]
                pred["over_odds_american"] = prop["odds_american"]
                # Pass through game context
                pred["home_team"] = prop.get("home_team")
                pred["away_team"] = prop.get("away_team")
                pred["game_time"] = prop.get("game_time")
                pred["game_id"] = prop.get("game_id", "")
                predictions.append(pred)

        return predictions


if __name__ == "__main__":
    print("=== Woods System — Model Test ===\n")

    model = PropModel()

    # Test predictions
    test_cases = [
        ("Luka Doncic", "player_points", 28.5),
        ("LeBron James", "player_points", 25.5),
        ("Nikola Jokic", "player_rebounds", 12.5),
        ("Nikola Jokic", "player_assists", 9.5),
        ("Luka Doncic", "player_threes", 3.5),
    ]

    for player, market, line in test_cases:
        pred = model.predict_over_probability(player, market, line, is_home=True)
        if pred:
            stat = market.replace("player_", "").upper()
            print(f"{player} — {stat} Over {line}")
            print(f"  Model probability: {pred['model_prob_over']:.1%}")
            print(f"  Expected output:   {pred['expected_value']}")
            print(f"  Confidence:        {pred['confidence']:.0%}")
            print(f"  Adjustments:       {pred['adjustments']}")
            print()
