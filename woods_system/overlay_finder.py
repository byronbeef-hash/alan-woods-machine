"""
Woods System — Overlay Finder
Compares model probabilities to market-implied probabilities
to find mispriced bets.

This is the core of Alan's methodology:
"We searched for what we called OVERLAYS — any horse that had been
under-bet by the public and whose odds were inflated as a result."

Win Expectation = Model Probability × Decimal Odds
If > 1.0: it's an overlay (the market is giving you more than fair value)
If < 1.0: it's an underlay (the market is charging you too much)
"""

import config


class OverlayFinder:
    """
    Identifies overlays by comparing model probabilities to market odds.
    Uses Alan's Win Expectation formula and classifies overlays by tier.
    """

    def find_overlays(self, predictions: list[dict]) -> list[dict]:
        """
        Scan all predictions and identify overlays.

        For each prediction, we check both Over and Under sides.
        An overlay can exist on either side — sometimes the public
        over-bets the Over, making the Under the value play.

        Returns a sorted list of overlays, strongest first.
        """
        overlays = []

        for pred in predictions:
            # --- Check the OVER side ---
            over_overlay = self._evaluate_side(
                pred=pred,
                side="Over",
                model_prob=pred["model_prob_over"],
                market_implied=pred.get("market_implied_over", 0.5),
                odds_decimal=pred.get("over_odds_decimal", 2.0),
                odds_american=pred.get("over_odds_american", 100),
            )
            if over_overlay:
                overlays.append(over_overlay)

            # --- Check the UNDER side ---
            if "market_implied_under" in pred:
                under_overlay = self._evaluate_side(
                    pred=pred,
                    side="Under",
                    model_prob=pred["model_prob_under"],
                    market_implied=pred["market_implied_under"],
                    odds_decimal=pred.get("under_odds_decimal", 2.0),
                    odds_american=pred.get("under_odds_american", 100),
                )
                if under_overlay:
                    overlays.append(under_overlay)

        # Sort by edge (strongest overlay first)
        overlays.sort(key=lambda x: x["edge"], reverse=True)
        return overlays

    def _evaluate_side(
        self, pred: dict, side: str,
        model_prob: float, market_implied: float,
        odds_decimal: float, odds_american: int,
    ) -> dict | None:
        """
        Evaluate one side (Over or Under) for overlay status.

        The math is simple but powerful:
        - Edge = Model Probability - Market Implied Probability
        - Win Expectation = Model Probability × Decimal Odds
        - If Edge > threshold, it's a playable overlay
        """
        # Remove the vig to get true market probability
        # (Market implied probabilities for Over + Under sum to > 1 due to vig)
        # We compare against the raw implied prob for edge calculation
        edge = model_prob - market_implied

        # Win Expectation (Alan's formula)
        win_expectation = model_prob * odds_decimal

        # Only flag if edge exceeds minimum threshold
        if edge < config.MIN_EDGE_THRESHOLD:
            return None

        # Classify the overlay tier
        tier = "MARGINAL"
        for tier_name, threshold in sorted(
            config.OVERLAY_TIERS.items(),
            key=lambda x: x[1],
            reverse=True,
        ):
            if edge >= threshold:
                tier = tier_name
                break

        # Confidence-adjusted edge (discount by model confidence)
        confidence = pred.get("confidence", 0.5)
        adjusted_edge = edge * confidence

        return {
            "player": pred["player"],
            "market": pred["market"],
            "stat": pred["stat"],
            "line": pred["line"],
            "side": side,
            "model_prob": round(model_prob, 4),
            "market_implied": round(market_implied, 4),
            "edge": round(edge, 4),
            "adjusted_edge": round(adjusted_edge, 4),
            "win_expectation": round(win_expectation, 4),
            "odds_decimal": odds_decimal,
            "odds_american": odds_american,
            "tier": tier,
            "confidence": confidence,
            "expected_value": pred.get("expected_value", 0),
            "base_mean": pred.get("base_mean", 0),
            "adjustments": pred.get("adjustments", {}),
        }

    def format_overlay_report(self, overlays: list[dict]) -> str:
        """
        Format overlays into a readable report.
        Alan would have seen something similar on his screen
        before each Hong Kong race meeting.
        """
        if not overlays:
            return "\n  No overlays found. Alan would say: 'Be patient. Wait for the edge.'\n"

        lines = []
        lines.append("")
        lines.append("=" * 78)
        lines.append("  OVERLAY REPORT — Woods System")
        lines.append("  'We only bet when the public has mispriced the odds.'")
        lines.append("=" * 78)

        for i, o in enumerate(overlays, 1):
            tier_icon = {"STRONG": ">>>", "MODERATE": ">> ", "MARGINAL": ">  "}
            icon = tier_icon.get(o["tier"], ">  ")

            stat_label = o["market"].replace("player_", "").upper()
            lines.append("")
            lines.append(f"  {icon} #{i} [{o['tier']}] {o['player']}")
            lines.append(f"      {stat_label} {o['side']} {o['line']} @ {o['odds_american']:+d} "
                         f"(decimal: {o['odds_decimal']:.2f})")
            lines.append(f"      Model: {o['model_prob']:.1%}  |  "
                         f"Market: {o['market_implied']:.1%}  |  "
                         f"Edge: {o['edge']:.1%}")
            lines.append(f"      Win Expectation: {o['win_expectation']:.3f}  |  "
                         f"Confidence: {o['confidence']:.0%}")
            lines.append(f"      Expected output: {o['expected_value']}  "
                         f"(season avg: {o['base_mean']})")

            if o["adjustments"]:
                adj_str = ", ".join(f"{k}: {v:+.1f}" for k, v in o["adjustments"].items())
                lines.append(f"      Adjustments: {adj_str}")

        lines.append("")
        lines.append("-" * 78)
        strong = sum(1 for o in overlays if o["tier"] == "STRONG")
        moderate = sum(1 for o in overlays if o["tier"] == "MODERATE")
        marginal = sum(1 for o in overlays if o["tier"] == "MARGINAL")
        lines.append(f"  TOTAL: {len(overlays)} overlays found  "
                     f"({strong} strong, {moderate} moderate, {marginal} marginal)")
        lines.append("=" * 78)

        return "\n".join(lines)
