"""
Woods System — Kelly Criterion Bet Sizing

Alan used Kelly's Criterion: bet to win a percentage of bankroll
equal to your percentage advantage on each wager. In practice,
his team bet at about two-thirds Kelly to smooth out volatility
while still capturing roughly 90% of maximum theoretical profit.

We default to quarter-Kelly (more conservative) because:
1. Our model is less battle-tested than Alan's was
2. Fractional Kelly dramatically reduces drawdown risk
3. You still capture ~50% of theoretical optimal growth
4. It gives you more runway to learn and refine

The formula (commission-adjusted):
    effective_b = (odds - 1) × (1 - commission_rate)
    Kelly % = (effective_b × p - q) / effective_b
    Adjusted Kelly % = Kelly % × KELLY_FRACTION
    Bet size = Adjusted Kelly % × Bankroll

With caps to prevent any single bet from being too large.
"""

import config


class KellyBetSizer:
    """
    Calculates optimal bet sizes using fractional Kelly Criterion.
    """

    def __init__(self, bankroll: float = None):
        self.bankroll = bankroll or config.STARTING_BANKROLL
        self.kelly_fraction = config.KELLY_FRACTION
        self.commission_rate = config.COMMISSION_RATE

    def size_bet(self, overlay: dict) -> dict:
        """
        Calculate the Kelly-optimal bet size for a single overlay.

        Returns a dict with:
        - full_kelly_pct: what full Kelly would recommend
        - adjusted_kelly_pct: after applying our fraction
        - bet_size: actual dollar amount to bet
        - potential_profit: what you'd win
        - risk_reward: ratio of potential profit to risk
        """
        model_prob = overlay["model_prob"]
        odds_decimal = overlay["odds_decimal"]

        # Full Kelly formula with commission adjustment:
        # b = decimal odds - 1, effective_b = b × (1 - commission)
        # f* = (effective_b × p - q) / effective_b
        b = odds_decimal - 1
        effective_b = b * (1 - self.commission_rate)
        p = model_prob
        q = 1 - p

        if effective_b <= 0:
            return self._no_bet(overlay, "Invalid odds")

        full_kelly = (effective_b * p - q) / effective_b

        # If Kelly is negative, there's no edge (shouldn't happen if
        # overlay_finder did its job, but safety check)
        if full_kelly <= 0:
            return self._no_bet(overlay, "Negative Kelly (no edge)")

        # Apply fractional Kelly
        adjusted_kelly = full_kelly * self.kelly_fraction

        # Apply tier-based maximum bet cap
        tier = overlay.get("tier", "MARGINAL")
        tier_cap = config.MAX_BET_BY_TIER.get(tier, config.MAX_BET_FRACTION)
        adjusted_kelly = min(adjusted_kelly, tier_cap)

        # Calculate actual bet size
        bet_size = self.bankroll * adjusted_kelly
        bet_size = max(bet_size, config.MIN_BET_SIZE)  # Floor
        bet_size = min(bet_size, self.bankroll * tier_cap)  # Cap

        # Round to clean dollar amount
        bet_size = round(bet_size, 0)

        potential_profit = bet_size * effective_b

        return {
            "player": overlay["player"],
            "market": overlay["market"],
            "side": overlay["side"],
            "line": overlay["line"],
            "odds_american": overlay["odds_american"],
            "odds_decimal": odds_decimal,
            "edge": overlay["edge"],
            "tier": overlay["tier"],
            "model_prob": model_prob,
            "full_kelly_pct": round(full_kelly * 100, 2),
            "adjusted_kelly_pct": round(adjusted_kelly * 100, 2),
            "bet_size": bet_size,
            "potential_profit": round(potential_profit, 2),
            "risk_reward": round(potential_profit / bet_size, 2) if bet_size > 0 else 0,
            "bankroll": self.bankroll,
            "bankroll_pct": round((bet_size / self.bankroll) * 100, 2),
            "home_team": overlay.get("home_team"),
            "away_team": overlay.get("away_team"),
            "game_time": overlay.get("game_time"),
        }

    def size_all_bets(self, overlays: list[dict]) -> list[dict]:
        """
        Size bets for all overlays, respecting portfolio-level constraints.

        Alan's key discipline: never risk so much on correlated bets
        that a single bad night wipes you out.
        """
        bets = []
        total_exposure = 0
        max_total_exposure = self.bankroll * 0.40  # Max 40% of bankroll at risk

        for overlay in overlays:
            bet = self.size_bet(overlay)
            if "skip_reason" in bet:
                continue

            # Check total exposure limit
            if total_exposure + bet["bet_size"] > max_total_exposure:
                remaining = max_total_exposure - total_exposure
                if remaining >= config.MIN_BET_SIZE:
                    bet["bet_size"] = round(remaining, 0)
                    bet["potential_profit"] = round(
                        bet["bet_size"] * (bet["odds_decimal"] - 1) * (1 - self.commission_rate), 2
                    )
                    bet["bankroll_pct"] = round(
                        (bet["bet_size"] / self.bankroll) * 100, 2
                    )
                    bet["capped"] = True
                    bets.append(bet)
                break

            total_exposure += bet["bet_size"]
            bets.append(bet)

            # Enforce max auto bets per scan
            if len(bets) >= config.MAX_AUTO_BETS:
                break

        return bets

    def _no_bet(self, overlay: dict, reason: str) -> dict:
        return {
            "player": overlay["player"],
            "market": overlay["market"],
            "side": overlay["side"],
            "line": overlay["line"],
            "skip_reason": reason,
            "bet_size": 0,
        }

    def format_bet_card(self, bets: list[dict]) -> str:
        """
        Format the bet card — what Alan's team would have taken
        to the Hong Kong Jockey Club window.
        """
        if not bets:
            return "\n  No bets today. Discipline is the edge.\n"

        lines = []
        lines.append("")
        lines.append("=" * 78)
        lines.append("  BET CARD — Woods System")
        lines.append(f"  Bankroll: ${self.bankroll:,.0f}  |  "
                     f"Kelly Fraction: {self.kelly_fraction:.0%}  |  "
                     f"Min Edge: {config.MIN_EDGE_THRESHOLD:.0%}")
        lines.append("=" * 78)

        total_risk = 0
        total_potential = 0

        for i, bet in enumerate(bets, 1):
            stat = bet["market"].replace("player_", "").upper()
            lines.append("")
            lines.append(f"  BET #{i}: {bet['player']}")
            lines.append(f"    Play:     {stat} {bet['side']} {bet['line']} "
                         f"@ {bet['odds_american']:+d}")
            lines.append(f"    Stake:    ${bet['bet_size']:,.0f} "
                         f"({bet['bankroll_pct']:.1f}% of bankroll)")
            lines.append(f"    To Win:   ${bet['potential_profit']:,.0f} "
                         f"(risk/reward: {bet['risk_reward']:.2f}x)")
            lines.append(f"    Edge:     {bet['edge']:.1%}  |  "
                         f"Kelly: {bet['full_kelly_pct']:.1f}% full → "
                         f"{bet['adjusted_kelly_pct']:.1f}% adjusted")
            lines.append(f"    Model:    {bet['model_prob']:.1%} win probability  "
                         f"[{bet['tier']}]")

            if bet.get("capped"):
                lines.append(f"    NOTE:     Capped due to total exposure limit")

            total_risk += bet["bet_size"]
            total_potential += bet["potential_profit"]

        lines.append("")
        lines.append("-" * 78)
        lines.append(f"  TOTALS: {len(bets)} bets  |  "
                     f"Risk: ${total_risk:,.0f} ({total_risk/self.bankroll:.1%} of bankroll)  |  "
                     f"Potential: ${total_potential:,.0f}")
        lines.append(f"  Expected Value: ${total_risk * 0.05:,.0f} "
                     f"(assuming ~5% average edge)")
        lines.append("=" * 78)

        return "\n".join(lines)

    def update_bankroll(self, new_bankroll: float):
        """Update bankroll after results come in."""
        self.bankroll = new_bankroll
