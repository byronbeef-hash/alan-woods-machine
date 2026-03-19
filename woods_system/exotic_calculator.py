"""
Woods System — Exotic Bet Calculator (Quinella, Trifecta, First Four)

Alan Woods made most of his money on exotic bets because:
1. The pools are less efficient (casual punters dominate)
2. The payouts are exponentially larger
3. If you can accurately rank the top 3-4 horses, the edge compounds

This module takes win probabilities from the horse racing model and
calculates expected returns for exotic combinations.

Quinella: Pick first 2 in any order
Trifecta: Pick first 3 in exact order
First Four: Pick first 4 in exact order

P(quinella A,B) = P(A wins) × P(B 2nd|A wins) + P(B wins) × P(A 2nd|B wins)
P(trifecta A,B,C) = P(A wins) × P(B 2nd|A wins) × P(C 3rd|A,B placed)

Conditional probabilities are calculated by removing placed horses
from the field and renormalising remaining probabilities.
"""

from itertools import combinations, permutations
from typing import Optional


class ExoticCalculator:
    """
    Calculate exotic bet probabilities from individual win probabilities.

    Based on the Harville model (1973) — the standard approach used by
    professional syndicates including Alan Woods' team.

    The Harville assumption: P(horse finishes nth | horses 1..n-1 already placed)
    = P(horse wins a race with only the remaining horses)
    = horse_prob / sum(remaining_probs)
    """

    def __init__(self, runners: list[dict]):
        """
        Args:
            runners: List of dicts with at minimum:
                - name: str
                - model_prob: float (win probability, should sum to ~1.0)
                - back_price: float (Betfair back odds)
        """
        self.runners = sorted(runners, key=lambda r: r['model_prob'], reverse=True)
        self.n = len(runners)

        # Normalise probabilities to sum to 1.0
        total = sum(r['model_prob'] for r in self.runners)
        if total > 0:
            for r in self.runners:
                r['norm_prob'] = r['model_prob'] / total
        else:
            for r in self.runners:
                r['norm_prob'] = 1.0 / self.n

    # ------------------------------------------------------------------
    # Core probability calculations (Harville model)
    # ------------------------------------------------------------------

    def prob_wins(self, runner_idx: int) -> float:
        """P(runner finishes 1st)."""
        return self.runners[runner_idx]['norm_prob']

    def prob_second(self, runner_idx: int, winner_idx: int) -> float:
        """P(runner finishes 2nd | given winner)."""
        if runner_idx == winner_idx:
            return 0.0

        remaining_prob = 1.0 - self.runners[winner_idx]['norm_prob']
        if remaining_prob <= 0:
            return 0.0

        return self.runners[runner_idx]['norm_prob'] / remaining_prob

    def prob_third(self, runner_idx: int, first_idx: int, second_idx: int) -> float:
        """P(runner finishes 3rd | given 1st and 2nd)."""
        if runner_idx in (first_idx, second_idx):
            return 0.0

        remaining_prob = (1.0
                         - self.runners[first_idx]['norm_prob']
                         - self.runners[second_idx]['norm_prob'])
        if remaining_prob <= 0:
            return 0.0

        return self.runners[runner_idx]['norm_prob'] / remaining_prob

    def prob_fourth(self, runner_idx: int, first_idx: int,
                    second_idx: int, third_idx: int) -> float:
        """P(runner finishes 4th | given 1st, 2nd, 3rd)."""
        if runner_idx in (first_idx, second_idx, third_idx):
            return 0.0

        remaining_prob = (1.0
                         - self.runners[first_idx]['norm_prob']
                         - self.runners[second_idx]['norm_prob']
                         - self.runners[third_idx]['norm_prob'])
        if remaining_prob <= 0:
            return 0.0

        return self.runners[runner_idx]['norm_prob'] / remaining_prob

    # ------------------------------------------------------------------
    # Exotic bet probabilities
    # ------------------------------------------------------------------

    def quinella_prob(self, idx_a: int, idx_b: int) -> float:
        """
        P(A and B finish 1st and 2nd in any order).
        = P(A 1st) × P(B 2nd|A) + P(B 1st) × P(A 2nd|B)
        """
        p_ab = self.prob_wins(idx_a) * self.prob_second(idx_b, idx_a)
        p_ba = self.prob_wins(idx_b) * self.prob_second(idx_a, idx_b)
        return p_ab + p_ba

    def exacta_prob(self, first_idx: int, second_idx: int) -> float:
        """
        P(A finishes 1st, B finishes 2nd) — exact order.
        = P(A 1st) × P(B 2nd|A)
        """
        return self.prob_wins(first_idx) * self.prob_second(second_idx, first_idx)

    def trifecta_prob(self, first_idx: int, second_idx: int, third_idx: int) -> float:
        """
        P(A 1st, B 2nd, C 3rd) — exact order.
        = P(A 1st) × P(B 2nd|A) × P(C 3rd|A,B)
        """
        return (self.prob_wins(first_idx)
                * self.prob_second(second_idx, first_idx)
                * self.prob_third(third_idx, first_idx, second_idx))

    def trifecta_box_prob(self, idx_a: int, idx_b: int, idx_c: int) -> float:
        """
        P(A, B, C finish in top 3 in any order).
        Sum of all 6 permutations of the trifecta.
        """
        total = 0.0
        for perm in permutations([idx_a, idx_b, idx_c]):
            total += self.trifecta_prob(perm[0], perm[1], perm[2])
        return total

    def first_four_prob(self, idxs: list[int]) -> float:
        """P(four horses finish 1st-4th in exact order)."""
        if len(idxs) != 4:
            return 0.0
        return (self.prob_wins(idxs[0])
                * self.prob_second(idxs[1], idxs[0])
                * self.prob_third(idxs[2], idxs[0], idxs[1])
                * self.prob_fourth(idxs[3], idxs[0], idxs[1], idxs[2]))

    def first_four_box_prob(self, idxs: list[int]) -> float:
        """P(four horses fill first four in any order)."""
        total = 0.0
        for perm in permutations(idxs):
            total += self.first_four_prob(list(perm))
        return total

    # ------------------------------------------------------------------
    # Win Expectation calculations
    # ------------------------------------------------------------------

    def top_quinellas(self, n: int = 10, min_we: float = 1.0) -> list[dict]:
        """
        Find the best quinella combinations by Win Expectation.

        Since Betfair doesn't have quinella markets, we estimate the
        fair quinella dividend from the individual probabilities:
        Fair quinella odds ≈ 1 / quinella_prob

        W.E. = model_quinella_prob × estimated_quinella_odds
        """
        results = []
        top_n = min(8, self.n)  # Only check top 8 runners for speed

        for i, j in combinations(range(top_n), 2):
            prob = self.quinella_prob(i, j)
            if prob <= 0:
                continue

            # Estimate quinella odds from market
            # Use product of individual back prices as rough guide
            market_prob = (1 / self.runners[i]['back_price']) * (1 / self.runners[j]['back_price']) * 2
            # Normalise — this is approximate
            fair_odds = 1 / prob if prob > 0 else 999
            market_odds = 1 / market_prob if market_prob > 0 else 999

            we = prob * market_odds

            results.append({
                'type': 'quinella',
                'runners': [self.runners[i]['name'], self.runners[j]['name']],
                'indices': [i, j],
                'model_prob': round(prob, 6),
                'fair_odds': round(fair_odds, 1),
                'est_market_odds': round(market_odds, 1),
                'we': round(we, 3),
            })

        results.sort(key=lambda x: x['we'], reverse=True)
        return results[:n]

    def top_trifectas(self, n: int = 10, box: bool = True) -> list[dict]:
        """
        Find the best trifecta box combinations.
        """
        results = []
        top_n = min(6, self.n)  # Top 6 runners for trifecta (20 combos)

        for combo in combinations(range(top_n), 3):
            if box:
                prob = self.trifecta_box_prob(combo[0], combo[1], combo[2])
            else:
                prob = self.trifecta_prob(combo[0], combo[1], combo[2])

            if prob <= 0:
                continue

            # Estimate trifecta odds
            fair_odds = 1 / prob if prob > 0 else 9999

            results.append({
                'type': 'trifecta_box' if box else 'trifecta',
                'runners': [self.runners[i]['name'] for i in combo],
                'indices': list(combo),
                'model_prob': round(prob, 6),
                'fair_odds': round(fair_odds, 1),
                'we_estimate': round(prob * fair_odds * 1.1, 3),  # Assume 10% market inefficiency
            })

        results.sort(key=lambda x: x['model_prob'], reverse=True)
        return results[:n]

    # ------------------------------------------------------------------
    # Place market analysis
    # ------------------------------------------------------------------

    def place_prob(self, runner_idx: int, places: int = 3) -> float:
        """
        P(runner finishes in top N places).
        Calculated by summing over all possible finishing positions.
        """
        if places == 1:
            return self.prob_wins(runner_idx)

        # For place (top 3), approximate using sum of conditional probs
        # This is computationally expensive for exact calculation,
        # so use the Harville approximation
        prob = self.prob_wins(runner_idx)  # P(1st)

        # P(2nd) = sum over all possible winners of P(winner) * P(this horse 2nd|winner)
        for w in range(self.n):
            if w == runner_idx:
                continue
            prob += self.prob_wins(w) * self.prob_second(runner_idx, w)

        if places >= 3:
            # P(3rd) — approximate by using average conditional
            # For exact: sum over all (1st, 2nd) pairs
            # Approximation: use Harville formula
            for w in range(min(6, self.n)):  # Top 6 winners
                if w == runner_idx:
                    continue
                for s in range(min(6, self.n)):  # Top 6 second
                    if s in (w, runner_idx):
                        continue
                    prob += (self.prob_wins(w)
                            * self.prob_second(s, w)
                            * self.prob_third(runner_idx, w, s))

        return min(prob, 0.99)

    def analyse_place_market(self, betfair_place_prices: dict = None) -> list[dict]:
        """
        Analyse the place (each-way) market for overlays.

        If betfair_place_prices provided, calculate W.E. for place bets.
        """
        results = []
        places = 3 if self.n >= 8 else 2

        for i in range(self.n):
            pp = self.place_prob(i, places)
            runner = self.runners[i]

            place_we = 0
            if betfair_place_prices and runner['name'] in betfair_place_prices:
                place_back = betfair_place_prices[runner['name']]
                place_we = pp * place_back

            results.append({
                'name': runner['name'],
                'win_prob': runner['norm_prob'],
                'place_prob': round(pp, 4),
                'back_price': runner['back_price'],
                'place_we': round(place_we, 3) if place_we else None,
            })

        return results


# ======================================================================
# CLI demo
# ======================================================================

if __name__ == "__main__":
    # Demo with a sample race
    runners = [
        {'name': 'Spunkys Gotsecrets', 'model_prob': 0.35, 'back_price': 1.30},
        {'name': 'Mister Brillante', 'model_prob': 0.20, 'back_price': 4.70},
        {'name': 'Captain Dorian', 'model_prob': 0.12, 'back_price': 9.40},
        {'name': 'Katlas Dream', 'model_prob': 0.10, 'back_price': 6.00},
        {'name': 'Rockin Bull', 'model_prob': 0.08, 'back_price': 8.00},
        {'name': 'Rocknroll Clarry', 'model_prob': 0.06, 'back_price': 15.00},
        {'name': 'Ultimate Trouble', 'model_prob': 0.05, 'back_price': 9.40},
        {'name': 'Robust Easton', 'model_prob': 0.04, 'back_price': 19.50},
    ]

    calc = ExoticCalculator(runners)

    print("=" * 70)
    print("  EXOTIC BET CALCULATOR — Sample Race")
    print("=" * 70)

    # Win probabilities
    print("\n  WIN PROBABILITIES (normalised):")
    for i, r in enumerate(calc.runners):
        we = r['norm_prob'] * r['back_price']
        verdict = "OVERLAY" if we > 1.05 else "MARGINAL" if we > 0.92 else "underlay"
        print(f"    {r['name']:25s}  {r['norm_prob']:.1%}  @ {r['back_price']:>6.2f}  W.E. = {we:.3f}  [{verdict}]")

    # Top quinellas
    print("\n  TOP QUINELLA COMBINATIONS:")
    quins = calc.top_quinellas(10)
    for q in quins:
        print(f"    {q['runners'][0]:20s} + {q['runners'][1]:20s}  |  Prob: {q['model_prob']:.2%}  |  Fair: ${q['fair_odds']:.0f}  |  W.E. ≈ {q['we']:.3f}")

    # Top trifecta boxes
    print("\n  TOP TRIFECTA BOX COMBINATIONS:")
    tris = calc.top_trifectas(10, box=True)
    for t in tris:
        names = ', '.join(t['runners'])
        print(f"    {names:60s}  |  Prob: {t['model_prob']:.3%}  |  Fair: ${t['fair_odds']:.0f}")

    # Place probabilities
    print("\n  PLACE PROBABILITIES (top 3):")
    places = calc.analyse_place_market()
    for p in places:
        print(f"    {p['name']:25s}  Win: {p['win_prob']:.1%}  |  Place: {p['place_prob']:.1%}")
