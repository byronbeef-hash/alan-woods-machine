"""
Woods System — Horse Racing Model (Betfair Exchange)

Alan Woods' approach: estimate true win probability from data,
compare to market odds, bet only when Win Expectation > 1.05
(after 5% Betfair commission).

Model factors (in order of predictive power):
1. Recent form (last 5 finishes) — strongest predictor
2. Barrier draw — inside barriers have measurable advantage
3. Jockey/trainer combo — elite combos outperform market pricing
4. Weight — lighter weight = advantage (especially in handicaps)
5. Days since last run — freshness/fitness indicator
6. Age — peak performance window
7. Distance suitability — inferred from form at similar distances
8. Class level — inferred from race grade

Win Expectation = P(win) × back_odds
After 5% commission: net W.E. = P(win) × ((back_odds - 1) × 0.95 + 1)
Bet when net W.E. > 1.05 (need 5% edge minimum after commission)
"""

import math
import statistics
from datetime import datetime, timezone, timedelta
from collections import defaultdict

from betfair_client import BetfairClient
from racing_scraper import RacingScraper, enforce_betting_rules, is_gallops_race


# ---------------------------------------------------------------------------
# Model parameters (calibrated from historical AU racing data)
# ---------------------------------------------------------------------------

# Barrier win rate multipliers (AU tracks, all distances)
# Inside barriers have consistent edge, especially sprint races
BARRIER_FACTORS = {
    1: 1.15, 2: 1.10, 3: 1.05, 4: 1.02, 5: 1.00,
    6: 0.98, 7: 0.96, 8: 0.95, 9: 0.93, 10: 0.92,
    11: 0.91, 12: 0.90, 13: 0.89, 14: 0.88, 15: 0.87,
    16: 0.86, 17: 0.85, 18: 0.84, 19: 0.83, 20: 0.82,
}

# Form position scoring — more recent races weighted higher
# Position 1 = win, 2 = second, etc. x = fall/scratch
FORM_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08]  # Most recent first

# Jockey win rate priors (top AU jockeys)
# These are used to adjust the model when we don't have full stats
ELITE_JOCKEYS = {
    'James McDonald', 'Damian Lane', 'Hugh Bowman', 'Kerrin McEvoy',
    'Nash Rawiller', 'Tom Marquand', 'Brenton Avdulla', 'Rachel King',
    'Josh Parr', 'Tim Clark', 'Martin Harley', 'Craig Williams',
    'Damien Oliver', 'Jamie Kah', 'Luke Currie', 'Jye McNeil',
    'Mark Zahra', 'Ben Melham', 'Daniel Moor',
}

ELITE_TRAINERS = {
    'Chris Waller', 'James Cummings', 'Ciaron Maher', 'Peter Moody',
    'Tony Gollan', 'Annabel Neasham', 'Gai Waterhouse', 'Adrian Bott',
    'John O\'Shea', 'Bjorn Baker', 'Mark Newnham', 'David Payne',
    'Matthew Dunn', 'Peter Snowden', 'Paul Snowden', 'John Thompson',
    'Michael Freedman', 'Robert Heathcote', 'Kris Lees',
}

# Days since last run — optimal freshness window
# Horses that haven't raced in 2-4 weeks typically perform best
# First-up (long spell) is penalised, back-to-back is penalised
FRESHNESS_FACTORS = {
    0: 0.90,    # Debut / unknown
    7: 0.97,    # 1 week — too quick
    14: 1.03,   # 2 weeks — good
    21: 1.05,   # 3 weeks — optimal
    28: 1.03,   # 4 weeks — good
    42: 1.00,   # 6 weeks — neutral
    56: 0.97,   # 8 weeks — getting stale
    84: 0.95,   # 12 weeks — spell
    120: 0.92,  # 4+ months — long spell
}

# Weight impact per kg difference from median
# In handicap races, each kg ≈ 0.5-1 length ≈ ~2% win probability shift
WEIGHT_FACTOR_PER_KG = 0.015  # 1.5% per kg below median

# Age performance curve
AGE_FACTORS = {
    2: 0.95,  # 2yo — immature, volatile
    3: 1.05,  # 3yo — peak improvement
    4: 1.03,  # 4yo — mature prime
    5: 1.00,  # 5yo — experienced
    6: 0.97,  # 6yo — slight decline
    7: 0.94,  # 7yo — declining
    8: 0.90,  # 8yo+ — veteran
}

# Commission-adjusted thresholds
BETFAIR_COMMISSION = 0.05
MIN_WE_OVERLAY = 1.05    # Need 5% edge after commission
MIN_WE_MARGINAL = 0.92
MIN_LIQUIDITY = 20        # Minimum $ available to back
MIN_BACK_PRICE = 1.10     # Skip unbackable favourites


class HorseRacingModel:
    """
    Predicts horse win probabilities and finds overlays on Betfair.

    The model uses the market's own pricing as a base (Betfair odds reflect
    the wisdom of thousands of punters), then adjusts for systematic biases:
    - Barrier draw undervaluation
    - Jockey/trainer premium not fully priced in
    - Weight impact underestimated in handicaps
    - Freshness pattern (optimal days between runs)
    - Favourite-longshot bias
    """

    def __init__(self):
        self.bf = BetfairClient()
        self.scraper = RacingScraper()
        self._logged_in = False

    def _ensure_login(self):
        if not self._logged_in:
            self._logged_in = self.bf.login()
        return self._logged_in

    # ------------------------------------------------------------------
    # Core model
    # ------------------------------------------------------------------

    def calculate_model_probability(self, runner: dict, meta: dict,
                                     market_prob: float, field_size: int,
                                     median_weight: float,
                                     track_condition: str = None,
                                     weather: dict = None,
                                     formfav_stats: dict = None,
                                     gear_change: str = None) -> dict:
        """
        Calculate adjusted win probability for a single runner.

        Returns dict with model_prob, factors breakdown, and adjustments.
        """
        adjustments = {}
        combined_factor = 1.0

        # 1. FORM — strongest predictor (35% of total model weight per Benter)
        form_str = meta.get('FORM', '') or ''
        form_score = self._score_form(form_str)
        # Scale form: 0.80 (terrible) to 1.25 (winning machine)
        # Average form (0.4) maps to ~1.0 (neutral)
        form_factor = 0.80 + (form_score * 0.45)  # Range: 0.80 to 1.25
        combined_factor *= form_factor
        adjustments['form'] = round(form_factor - 1, 3)

        # 2. BARRIER DRAW — impact varies by race distance
        barrier = int(meta.get('STALL_DRAW', 5) or 5)
        barrier_factor = BARRIER_FACTORS.get(min(barrier, 20), 0.82)
        # Reduce barrier impact for longer races (1600m+) where early position matters less
        # and increase for sprints (< 1200m) where barrier is critical
        race_name = meta.get('_race_name', '')
        dist_match = __import__('re').search(r'(\d{3,4})m', race_name)
        if dist_match:
            dist = int(dist_match.group(1))
            if dist >= 2000:
                barrier_factor = 1.0 + (barrier_factor - 1.0) * 0.3  # 30% of normal impact
            elif dist >= 1600:
                barrier_factor = 1.0 + (barrier_factor - 1.0) * 0.5  # 50% of normal impact
            elif dist <= 1100:
                barrier_factor = 1.0 + (barrier_factor - 1.0) * 1.3  # 130% of normal impact for sprints
        combined_factor *= barrier_factor
        adjustments['barrier'] = round(barrier_factor - 1, 3)

        # 3. JOCKEY
        jockey = meta.get('JOCKEY_NAME', '')
        jockey_factor = 1.04 if jockey in ELITE_JOCKEYS else 1.00
        combined_factor *= jockey_factor
        adjustments['jockey'] = round(jockey_factor - 1, 3)

        # 4. TRAINER
        trainer = meta.get('TRAINER_NAME', '')
        trainer_factor = 1.03 if trainer in ELITE_TRAINERS else 1.00
        combined_factor *= trainer_factor
        adjustments['trainer'] = round(trainer_factor - 1, 3)

        # 5. WEIGHT (relative to field median)
        weight = float(meta.get('WEIGHT_VALUE', median_weight) or median_weight)
        weight_diff = median_weight - weight  # Positive = lighter = advantage
        weight_factor = 1.0 + (weight_diff * WEIGHT_FACTOR_PER_KG)
        combined_factor *= weight_factor
        adjustments['weight'] = round(weight_factor - 1, 3)

        # 6. FRESHNESS (days since last run)
        days = int(meta.get('DAYS_SINCE_LAST_RUN', 0) or 0)
        freshness_factor = self._get_freshness_factor(days)
        combined_factor *= freshness_factor
        adjustments['freshness'] = round(freshness_factor - 1, 3)

        # 7. AGE
        age = int(meta.get('AGE', 4) or 4)
        age_factor = AGE_FACTORS.get(min(age, 8), 0.90)
        combined_factor *= age_factor
        adjustments['age'] = round(age_factor - 1, 3)

        # 8. FAVOURITE-LONGSHOT BIAS
        back_price = 1.0 / market_prob if market_prob > 0 else 10.0
        flb_factor = self._get_flb_factor(back_price)
        combined_factor *= flb_factor
        adjustments['flb'] = round(flb_factor - 1, 3)

        # 8b. MARKET CONFIDENCE — lay liquidity as proxy for smart money
        # If lots of lay money = market is confident in the price (less opportunity)
        # If little lay money on a mid-range horse = potential mispricing
        lay_price = runner.get('ex', {}).get('availableToLay', [{}])[0].get('price', 0) if isinstance(runner.get('ex'), dict) else 0
        lay_size = runner.get('ex', {}).get('availableToLay', [{}])[0].get('size', 0) if isinstance(runner.get('ex'), dict) else 0
        back_avail = runner.get('ex', {}).get('availableToBack', [{}])[0].get('size', 0) if isinstance(runner.get('ex'), dict) else 0
        # Spread = difference between back and lay price
        # Tight spread = efficient pricing, wide spread = potential opportunity
        if lay_price > 0 and back_price > 0:
            spread_pct = (lay_price - back_price) / back_price
            if spread_pct > 0.10:  # Wide spread = less efficient = slight opportunity
                spread_factor = 1.02
            elif spread_pct < 0.02:  # Tight spread = very efficient = harder to beat
                spread_factor = 0.98
            else:
                spread_factor = 1.0
            combined_factor *= spread_factor
            adjustments['spread'] = round(spread_factor - 1, 3)

        # 8c. FIELD SIZE ADJUSTMENT
        # Larger fields = more variance = longshots hit more often
        if field_size >= 14:
            field_factor = 1.02 if back_price > 8 else 0.99
        elif field_size <= 6:
            field_factor = 0.98 if back_price > 8 else 1.01
        else:
            field_factor = 1.0
        combined_factor *= field_factor
        adjustments['field_size'] = round(field_factor - 1, 3)

        # 9. TRACK CONDITION (from FormFav)
        if track_condition:
            from track_weather import TrackWeatherService
            tw = TrackWeatherService()
            tc_result = tw.calculate_track_condition_factor(
                track_condition, runner.get('runnerName', ''), formfav_stats
            )
            combined_factor *= tc_result['factor']
            adjustments['track_condition'] = round(tc_result['factor'] - 1, 3)

        # 10. WEATHER
        if weather and weather.get('rain_mm', 0) > 0:
            from track_weather import TrackWeatherService
            tw = TrackWeatherService()
            wx_result = tw.calculate_weather_factor(weather)
            combined_factor *= wx_result['factor']
            adjustments['weather'] = round(wx_result['factor'] - 1, 3)

        # 11. TRACK SPECIALIST (from FormFav stats)
        if formfav_stats:
            from track_weather import TrackWeatherService
            tw = TrackWeatherService()
            ts_result = tw.calculate_track_stats_factor(formfav_stats)
            combined_factor *= ts_result['factor']
            adjustments['track_stats'] = round(ts_result['factor'] - 1, 3)

        # 12. GEAR CHANGE
        if gear_change:
            from track_weather import TrackWeatherService
            tw = TrackWeatherService()
            gc_result = tw.calculate_gear_change_factor(gear_change)
            combined_factor *= gc_result['factor']
            adjustments['gear_change'] = round(gc_result['factor'] - 1, 3)

        # Calculate model probability
        model_prob = market_prob * combined_factor

        # Clip to reasonable bounds
        model_prob = max(0.01, min(0.85, model_prob))

        return {
            'model_prob': round(model_prob, 4),
            'combined_factor': round(combined_factor, 3),
            'adjustments': adjustments,
            'form_score': round(form_score, 3),
            'form_str': form_str,
        }

    def _score_form(self, form_str: str) -> float:
        """
        Score recent form from 0 (terrible) to 1 (perfect).
        Uses weighted average of last 5 positions with non-linear scoring.

        Key improvements over linear scoring:
        - Winners (1) get exponential boost — a horse that wins is much better than 2nd
        - Placings (2-3) are solid — significantly better than unplaced
        - Unplaced (5-9) is penalised more harshly
        - 0 (10th+) and x (fall) are severely penalised
        - Consistency bonus: horses that always place get a boost
        """
        if not form_str:
            return 0.4  # Unknown form = below average (conservative)

        positions = []
        for ch in str(form_str):
            if ch == '0':
                positions.append(10)  # 10th or worse
            elif ch.isdigit():
                positions.append(int(ch))
            elif ch.lower() in ('x', 'f', 'd'):
                positions.append(12)  # Fall/DNF = very bad
            # Skip other chars like spaces, dashes

        if not positions:
            return 0.4

        # Take last 5 (most recent first)
        recent = positions[-5:]
        recent.reverse()  # Most recent first

        # Non-linear position scoring (Benter-style)
        POS_SCORES = {
            1: 1.00,   # Win — full marks
            2: 0.75,   # 2nd — strong
            3: 0.60,   # 3rd — solid placing
            4: 0.45,   # 4th — close
            5: 0.30,   # 5th — fair
            6: 0.20,   # 6th — mid-pack
            7: 0.12,   # 7th — below average
            8: 0.06,   # 8th — poor
            9: 0.03,   # 9th — very poor
        }

        total_weight = 0
        weighted_score = 0
        for i, pos in enumerate(recent):
            weight = FORM_WEIGHTS[i] if i < len(FORM_WEIGHTS) else 0.05
            pos_score = POS_SCORES.get(pos, 0.01)  # 10+ or fall = 0.01
            weighted_score += pos_score * weight
            total_weight += weight

        base_score = weighted_score / total_weight if total_weight > 0 else 0.4

        # Consistency bonus: if all recent runs are placed (1-3), boost
        placed_count = sum(1 for p in recent if p <= 3)
        if len(recent) >= 3 and placed_count >= 3:
            base_score = min(1.0, base_score * 1.08)  # 8% consistency bonus

        # Recent winner bonus: last start win gets extra weight
        if recent and recent[0] == 1:
            base_score = min(1.0, base_score * 1.05)  # 5% last-start winner bonus

        return base_score

    @staticmethod
    def _get_freshness_factor(days: int) -> float:
        """Interpolate freshness factor from days since last run."""
        if days <= 0:
            return 0.90

        # Find surrounding keys
        sorted_days = sorted(FRESHNESS_FACTORS.keys())
        for i in range(len(sorted_days) - 1):
            if sorted_days[i] <= days <= sorted_days[i + 1]:
                d1, d2 = sorted_days[i], sorted_days[i + 1]
                f1, f2 = FRESHNESS_FACTORS[d1], FRESHNESS_FACTORS[d2]
                # Linear interpolation
                ratio = (days - d1) / (d2 - d1)
                return f1 + (f2 - f1) * ratio

        # Beyond range
        return 0.90

    @staticmethod
    def _get_flb_factor(back_price: float) -> float:
        """
        Favourite-longshot bias correction for AUSTRALIAN racing.

        AU Betfair research (Snowberg & Wolfers 2010, Benter 1994):
        - Favourites ($1.50-$3) are UNDER-bet on exchanges — slight value
        - Mid-range ($4-$8) are efficiently priced
        - Longshots ($15+) are OVER-bet — punters overvalue big payoffs
        - This is the OPPOSITE of US tote markets

        Key: Betfair exchange markets have less FLB than tote, but it still exists.
        """
        if back_price < 2.0:
            return 1.03  # Short favs — slight underestimation on exchange
        elif back_price < 3.0:
            return 1.02  # Favs — mild value
        elif back_price < 5.0:
            return 1.01  # Short-mid — near efficient
        elif back_price < 8.0:
            return 1.00  # Mid-range — efficiently priced
        elif back_price < 15.0:
            return 0.99  # Mid-longshot — slight overestimation
        elif back_price < 25.0:
            return 0.97  # Longshot — punters over-bet these
        elif back_price < 50.0:
            return 0.95  # Big longshot — significant over-bet
        else:
            return 0.92  # Extreme longshot — almost never value

    # ------------------------------------------------------------------
    # Race scanning
    # ------------------------------------------------------------------

    def scan_race(self, market: dict, track_condition: str = None,
                  weather: dict = None, formfav_runners: dict = None) -> list[dict]:
        """Analyse a single race and return all runners with W.E."""
        market_id = market['marketId']
        market_name = market['marketName']
        start_time = market.get('marketStartTime', '')
        runners = market.get('runners', [])

        if len(runners) < 4:
            return []

        # Get live prices
        try:
            book = self.bf.get_market_prices(market_id)
        except Exception:
            return []

        # Calculate median weight for this race
        weights = []
        for r in runners:
            w = r.get('metadata', {}).get('WEIGHT_VALUE')
            if w:
                weights.append(float(w))
        median_weight = statistics.median(weights) if weights else 57.0

        field_size = len([br for br in book.get('runners', [])
                         if br.get('status') == 'ACTIVE'])

        results = []

        for br in book.get('runners', []):
            if br.get('status') != 'ACTIVE':
                continue

            selection_id = br['selectionId']
            runner = next((r for r in runners if r['selectionId'] == selection_id), None)
            if not runner:
                continue

            meta = runner.get('metadata', {})
            name = runner['runnerName']

            backs = br.get('ex', {}).get('availableToBack', [])
            lays = br.get('ex', {}).get('availableToLay', [])

            if not backs or backs[0]['size'] < MIN_LIQUIDITY:
                continue

            back_price = backs[0]['price']
            back_size = backs[0]['size']
            lay_price = lays[0]['price'] if lays else None
            lay_size = lays[0]['size'] if lays else 0

            if back_price < MIN_BACK_PRICE:
                continue

            market_prob = 1.0 / back_price

            # Look up FormFav stats for this runner
            runner_ff_stats = None
            runner_gear = None
            if formfav_runners:
                # Match by name (strip number prefix like "1. ")
                clean_name = name.split('. ', 1)[-1] if '. ' in name else name
                runner_ff_stats = formfav_runners.get(clean_name)
                if runner_ff_stats:
                    runner_gear = runner_ff_stats.get('gear_change')

            # Inject race name into meta for distance-based adjustments
            meta['_race_name'] = market_name

            # Run model
            model_result = self.calculate_model_probability(
                runner, meta, market_prob, field_size, median_weight,
                track_condition=track_condition,
                weather=weather,
                formfav_stats=runner_ff_stats,
                gear_change=runner_gear,
            )

            model_prob = model_result['model_prob']

            # Win Expectation
            we_raw = model_prob * back_price

            # Net W.E. after commission
            net_price = (back_price - 1) * (1 - BETFAIR_COMMISSION) + 1
            we_net = model_prob * net_price

            # Edge
            edge = model_prob - market_prob

            # Verdict
            if we_net > MIN_WE_OVERLAY:
                verdict = "OVERLAY"
                tier = "STRONG" if we_net > 1.10 else "MODERATE"
            elif we_net > MIN_WE_MARGINAL:
                verdict = "MARGINAL"
                tier = "MARGINAL"
            else:
                verdict = "UNDERLAY"
                tier = "AVOID"

            # Count data points used by the model
            data_points = 0
            data_sources = []
            form_str = meta.get('FORM', '') or ''
            if form_str:
                data_points += len([c for c in form_str if c.isdigit() or c.lower() in ('x', 'f', 'd')])
                data_sources.append(f"Form: {len([c for c in form_str if c.isdigit() or c.lower() in ('x','f','d')])} races")
            if meta.get('STALL_DRAW'):
                data_points += 1; data_sources.append("Barrier draw")
            if meta.get('JOCKEY_NAME'):
                data_points += 1
                jn = meta['JOCKEY_NAME']
                data_sources.append(f"Jockey: {jn}" + (" (ELITE)" if jn in ELITE_JOCKEYS else ""))
            if meta.get('TRAINER_NAME'):
                data_points += 1
                tn = meta['TRAINER_NAME']
                data_sources.append(f"Trainer: {tn}" + (" (ELITE)" if tn in ELITE_TRAINERS else ""))
            if meta.get('WEIGHT_VALUE'):
                data_points += 1; data_sources.append("Weight carried")
            if meta.get('AGE'):
                data_points += 1; data_sources.append("Age")
            if meta.get('DAYS_SINCE_LAST_RUN') and int(meta.get('DAYS_SINCE_LAST_RUN', 0) or 0) > 0:
                data_points += 1; data_sources.append("Days since last run")
            if meta.get('OFFICIAL_RATING') and meta['OFFICIAL_RATING'] != 'None':
                data_points += 1; data_sources.append(f"Official rating: {meta['OFFICIAL_RATING']}")
            if meta.get('SIRE_NAME'):
                data_points += 1; data_sources.append(f"Sire: {meta['SIRE_NAME']}")
            if meta.get('DAM_NAME'):
                data_points += 1; data_sources.append(f"Dam: {meta['DAM_NAME']}")

            # Parse form into individual race results
            form_parsed = []
            for ch in str(form_str):
                if ch.isdigit():
                    form_parsed.append({'position': int(ch), 'label': f'{ch}{"st" if ch=="1" else "nd" if ch=="2" else "rd" if ch=="3" else "th"}'})
                elif ch.lower() == 'x':
                    form_parsed.append({'position': 9, 'label': 'Fall/DNF'})
                elif ch.lower() == 'f':
                    form_parsed.append({'position': 9, 'label': 'Fell'})
                elif ch.lower() == '0':
                    form_parsed.append({'position': 10, 'label': '10th+'})

            results.append({
                'name': name,
                'barrier': int(meta.get('STALL_DRAW', 0) or 0),
                'jockey': meta.get('JOCKEY_NAME', ''),
                'trainer': meta.get('TRAINER_NAME', ''),
                'weight': float(meta.get('WEIGHT_VALUE', 0) or 0),
                'age': int(meta.get('AGE', 0) or 0),
                'form': form_str,
                'days_since_run': int(meta.get('DAYS_SINCE_LAST_RUN', 0) or 0),
                'race': market_name,
                'market_id': market_id,
                'selection_id': selection_id,
                'start_time': start_time,
                'field_size': field_size,
                'back_price': back_price,
                'back_size': back_size,
                'lay_price': lay_price,
                'lay_size': lay_size,
                'market_prob': round(market_prob, 4),
                'model_prob': model_prob,
                'combined_factor': model_result['combined_factor'],
                'adjustments': model_result['adjustments'],
                'form_score': model_result['form_score'],
                'form_parsed': form_parsed,
                'edge': round(edge, 4),
                'we_raw': round(we_raw, 3),
                'we_net': round(we_net, 3),
                'verdict': verdict,
                'tier': tier,
                # Extra metadata from Betfair
                'sex': meta.get('SEX_TYPE', ''),
                'colour': meta.get('COLOUR_TYPE', ''),
                'sire': meta.get('SIRE_NAME', ''),
                'dam': meta.get('DAM_NAME', ''),
                'damsire': meta.get('DAMSIRE_NAME', ''),
                'official_rating': meta.get('OFFICIAL_RATING', ''),
                'wearing': meta.get('WEARING', ''),
                'silk_url': meta.get('COLOURS_FILENAME_URL', ''),
                'cloth_number': meta.get('CLOTH_NUMBER', ''),
                'bred': meta.get('BRED', ''),
                'jockey_is_elite': meta.get('JOCKEY_NAME', '') in ELITE_JOCKEYS,
                'trainer_is_elite': meta.get('TRAINER_NAME', '') in ELITE_TRAINERS,
                'data_points': data_points,
                'data_sources': data_sources,
                'median_weight': round(median_weight, 1),
                # Track & weather (from FormFav + BOM)
                'track_condition': track_condition or '',
                'weather_rain': weather.get('rain_mm', 0) if weather else 0,
                'weather_temp': weather.get('temperature', 0) if weather else 0,
                'gear_change': runner_gear or '',
            })

        # Normalise model probabilities within race
        total_model = sum(r['model_prob'] for r in results)
        if total_model > 0:
            for r in results:
                r['model_prob'] = round(r['model_prob'] / total_model, 4)
                r['we_raw'] = round(r['model_prob'] * r['back_price'], 3)
                net_price = (r['back_price'] - 1) * (1 - BETFAIR_COMMISSION) + 1
                r['we_net'] = round(r['model_prob'] * net_price, 3)
                r['edge'] = round(r['model_prob'] - r['market_prob'], 4)

                # Re-evaluate verdict after normalisation
                if r['we_net'] > MIN_WE_OVERLAY:
                    r['verdict'] = "OVERLAY"
                    r['tier'] = "STRONG" if r['we_net'] > 1.10 else "MODERATE"
                elif r['we_net'] > MIN_WE_MARGINAL:
                    r['verdict'] = "MARGINAL"
                    r['tier'] = "MARGINAL"
                else:
                    r['verdict'] = "UNDERLAY"
                    r['tier'] = "AVOID"

        return results

    def scan_meeting(self, event_id: str, event_name: str = '',
                     include_place: bool = True) -> list[dict]:
        """Scan all races at a meeting (win + place markets)."""
        if not self._ensure_login():
            return []

        # Extract venue from event name (e.g. "Newcastle (AUS) 23rd Mar" -> "newcastle")
        venue = event_name.split('(')[0].strip().lower() if event_name else ''
        venue_slug = venue.replace(' ', '-')
        race_date = None
        try:
            # Extract date from event name
            import re
            date_match = re.search(r'(\d+)\w*\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)', event_name)
            if date_match:
                day = int(date_match.group(1))
                month_str = date_match.group(2)
                months = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                          'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}
                month = months.get(month_str, 3)
                year = datetime.now().year
                race_date = f'{year}-{month:02d}-{day:02d}'
        except Exception:
            race_date = datetime.now().strftime('%Y-%m-%d')

        # Fetch weather and track data from free sources
        track_condition = None
        weather_data = None
        formfav_runners = {}
        try:
            meeting_info = self.scraper.enrich_meeting(venue, race_date or datetime.now().strftime('%Y-%m-%d'))
            track_condition = meeting_info.get('track_condition')
            weather_data = meeting_info.get('weather')
            if track_condition:
                print(f"    Track: {track_condition} | Weather: {meeting_info.get('weather_summary', '?')}")
            elif weather_data:
                print(f"    Weather: {meeting_info.get('weather_summary', '?')}")
        except Exception as e:
            print(f"    [Weather] Error for {venue}: {e}")

        # Fetch both WIN and PLACE markets
        market_types = ['WIN']
        if include_place:
            market_types.append('PLACE')

        markets = self.bf._betting_call('listMarketCatalogue', {
            'filter': {
                'eventIds': [event_id],
                'marketTypeCodes': market_types,
            },
            'maxResults': '30',
            'marketProjection': ['RUNNER_METADATA', 'RUNNER_DESCRIPTION', 'MARKET_START_TIME'],
            'sort': 'FIRST_TO_START',
        })

        win_markets = [m for m in markets if m.get('description', {}).get('marketType') == 'WIN'
                       or 'To Be Placed' not in m.get('marketName', '')]
        place_markets = [m for m in markets if 'To Be Placed' in m.get('marketName', '')]

        print(f"\n  {event_name or event_id}: {len(win_markets)} win + {len(place_markets)} place races")

        all_results = []

        # Scan WIN markets
        for m in win_markets:
            results = self.scan_race(m, track_condition=track_condition,
                                     weather=weather_data, formfav_runners=formfav_runners)
            for r in results:
                r['bet_type'] = 'WIN'
            overlays = [r for r in results if r['verdict'] == 'OVERLAY']
            if overlays:
                print(f"    {m['marketName']} (WIN): {len(overlays)} overlay(s)")
                for o in overlays:
                    print(
                        f"      [{o['tier']:8s}] {o['name']:25s}"
                        f"  Back {o['back_price']:>6.2f} (${o['back_size']:>5.0f})"
                        f"  |  Model {o['model_prob']:.1%} vs Market {o['market_prob']:.1%}"
                        f"  |  W.E.(net) = {o['we_net']:.3f}"
                        f"  |  Form: {o['form'] or '?':>8}"
                        f"  |  B{o['barrier']} J:{(o['jockey'] or '')[:15]}"
                    )
            all_results.extend(results)

        # Scan PLACE markets (often less efficient = more overlays)
        for m in place_markets:
            results = self.scan_race(m, track_condition=track_condition,
                                     weather=weather_data, formfav_runners=formfav_runners)
            for r in results:
                r['bet_type'] = 'PLACE'
            overlays = [r for r in results if r['verdict'] == 'OVERLAY']
            if overlays:
                print(f"    {m['marketName']} (PLACE): {len(overlays)} overlay(s)")
                for o in overlays[:3]:  # Show top 3 only
                    print(
                        f"      [{o['tier']:8s}] {o['name']:25s}"
                        f"  Back {o['back_price']:>6.2f} (${o['back_size']:>5.0f})"
                        f"  |  W.E.(net) = {o['we_net']:.3f}"
                    )
            all_results.extend(results)

        return all_results

    def scan_all_meetings(self, hours_ahead: int = 48) -> list[dict]:
        """Scan all upcoming AU horse racing meetings."""
        if not self._ensure_login():
            return []

        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(hours=hours_ahead)

        events = self.bf._betting_call('listEvents', {
            'filter': {
                'eventTypeIds': ['7'],
                'marketCountries': ['AU'],
                'marketStartTime': {
                    'from': now.isoformat(),
                    'to': cutoff.isoformat(),
                },
            },
            'maxResults': '20',
        })

        if not events:
            print("No upcoming horse racing meetings found")
            return []

        print(f"\n{'='*70}")
        print(f"  HORSE RACING OVERLAY SCANNER")
        print(f"  {len(events)} meetings | Next {hours_ahead} hours")
        print(f"  'We only bet when the public has mispriced the odds.'")
        print(f"{'='*70}")

        all_results = []
        for e in events:
            ev = e['event']
            results = self.scan_meeting(ev['id'], ev['name'])
            all_results.extend(results)

        # Sort overlays by W.E. descending
        all_results.sort(key=lambda x: x['we_net'], reverse=True)
        return all_results

    def place_bet(self, market_id: str, selection_id: int,
                  stake: float, price: float) -> dict:
        """Place a BACK bet on Betfair Exchange."""
        if not self._ensure_login():
            return {'error': 'Not logged in'}
        return self.bf.place_bet(market_id, selection_id, stake, price)

    def get_balance(self) -> float:
        """Get current Betfair balance."""
        if not self._ensure_login():
            return 0
        return self.bf.get_balance()


def print_report(results: list[dict]):
    """Print formatted overlay report."""
    overlays = [r for r in results if r['verdict'] == 'OVERLAY']
    marginals = [r for r in results if r['verdict'] == 'MARGINAL']

    print(f"\n{'='*70}")
    print(f"  OVERLAY REPORT — Horse Racing")
    print(f"  {len(overlays)} overlays | {len(marginals)} marginal | {len(results)} runners analysed")
    print(f"{'='*70}")

    if overlays:
        print(f"\n  OVERLAYS (W.E. > {MIN_WE_OVERLAY} after 5% commission):")
        for o in overlays[:20]:
            adj_str = ' '.join(f"{k}:{v:+.0%}" for k, v in o['adjustments'].items() if abs(v) >= 0.01)
            print(
                f"\n    [{o['tier']:8s}] {o['name']}"
                f"\n      Race: {o['race']} | Start: {o['start_time'][:16]}"
                f"\n      Back {o['back_price']:.2f} (${o['back_size']:.0f})"
                f"  |  Model: {o['model_prob']:.1%}  Market: {o['market_prob']:.1%}"
                f"  |  Edge: {o['edge']:+.1%}"
                f"\n      W.E. = {o['we_raw']:.3f}  |  W.E.(net) = {o['we_net']:.3f}"
                f"\n      Form: {o['form'] or 'debut'}  |  B{o['barrier']}"
                f"  |  J: {o['jockey'][:20]}  |  T: {o['trainer'][:20]}"
                f"\n      {adj_str}"
            )

    if marginals:
        print(f"\n  MARGINAL ({MIN_WE_MARGINAL} < W.E. < {MIN_WE_OVERLAY}):")
        for o in marginals[:10]:
            print(
                f"    {o['name']:25s}"
                f"  Back {o['back_price']:>6.2f}"
                f"  |  W.E.(net) = {o['we_net']:.3f}"
                f"  |  Form: {o['form'] or '?':>8}"
                f"  |  {o['race']}"
            )


# ======================================================================
# Autonomous betting
# ======================================================================

def kelly_stake(we_net: float, bankroll: float, back_price: float,
                available_liquidity: float, max_fraction: float = 0.25,
                max_bet: float = 500.0) -> float:
    """
    Kelly Criterion bet sizing with liquidity constraint.

    Full Kelly: f = (b*p - q) / b
    We use fractional Kelly (25% by default) for safety.

    Constraints:
    - Never bet more than 10% of available liquidity
    - Never bet more than max_bet
    - Never bet more than max_fraction of bankroll
    """
    if we_net <= 1.0:
        return 0.0

    # Derive model prob from W.E. and net price
    net_price = (back_price - 1) * (1 - BETFAIR_COMMISSION) + 1
    model_prob = we_net / net_price
    b = net_price - 1  # Net payout per dollar
    p = model_prob
    q = 1 - p

    if b <= 0:
        return 0.0

    full_kelly = (b * p - q) / b
    if full_kelly <= 0:
        return 0.0

    fractional_kelly = full_kelly * max_fraction
    kelly_bet = bankroll * fractional_kelly

    # Apply constraints
    bet = min(
        kelly_bet,
        available_liquidity * 0.10,   # Max 10% of market liquidity
        max_bet,                       # Absolute max
        bankroll * 0.05,              # Max 5% of bankroll per bet
    )

    return max(round(bet, 2), 0)


def auto_bet(results: list[dict], max_bets: int = 10, bankroll: float = 2500.0,
             min_we: float = MIN_WE_OVERLAY, dry_run: bool = True,
             max_bet: float = 200.0) -> list[dict]:
    """
    Automatically place bets on overlays using Kelly Criterion sizing.

    Like Alan's system: bet every overlay, size according to edge,
    constrained by available liquidity.

    Args:
        results: Model results from scan_all_meetings()
        max_bets: Maximum bets to place per session
        bankroll: Current bankroll in AUD
        min_we: Minimum net W.E. to bet
        dry_run: If True, log but don't actually place
        max_bet: Maximum single bet size

    Returns:
        List of placed bet records
    """
    # Pre-filter by W.E., liquidity, price range
    candidates = [r for r in results
                  if r['we_net'] >= min_we
                  and r['back_size'] >= 30  # Minimum liquidity
                  and r['back_price'] >= 1.50  # Avoid unbackable favs
                  and r['back_price'] <= 50.0]  # Avoid crazy longshots

    # SAFETY: Apply betting rules — 1 per race, gallops only, no broken model races
    overlays = enforce_betting_rules(
        candidates,
        max_per_race=1,
        min_field_size=6,
        gallops_only=True,
    )

    if len(candidates) != len(overlays):
        removed = len(candidates) - len(overlays)
        print(f"  Safety rules removed {removed} bets (harness/same-race/small-field)")

    bets_placed = []
    total_staked = 0
    daily_limit = bankroll * 0.20  # Max 20% of bankroll per day
    model = HorseRacingModel()

    for o in overlays[:max_bets]:
        if total_staked >= daily_limit:
            print(f"  Daily limit reached (${daily_limit:.0f})")
            break

        stake = kelly_stake(
            we_net=o['we_net'],
            bankroll=bankroll,
            back_price=o['back_price'],
            available_liquidity=o['back_size'],
            max_bet=max_bet,
        )

        if stake < 5:  # Minimum $5 bet
            continue

        # Don't exceed daily limit
        stake = min(stake, daily_limit - total_staked)

        print(
            f"\n  {'[DRY RUN] ' if dry_run else '💰 '}${stake:.0f} on {o['name']}"
            f"  @ {o['back_price']:.2f}"
            f"  |  W.E.(net) = {o['we_net']:.3f}"
            f"  |  Edge: {o['edge']:+.1%}"
            f"  |  Kelly: ${stake:.0f}"
            f"  |  {o['race']}"
        )

        o['stake'] = stake
        total_staked += stake

        if not dry_run:
            result = model.place_bet(
                o['market_id'], o['selection_id'],
                stake, o['back_price']
            )
            o['bet_result'] = result
            print(f"    Betfair response: {result}")

        bets_placed.append(o)

    print(f"\n  Total: {len(bets_placed)} bets | ${total_staked:.0f} staked"
          f" | Avg W.E.: {sum(b['we_net'] for b in bets_placed)/max(len(bets_placed),1):.3f}")

    return bets_placed


# ======================================================================
# CLI
# ======================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("  Woods System — Horse Racing Overlay Scanner")
    print("  'The crowd sets a price. We find where they're wrong.'")
    print("=" * 70)

    model = HorseRacingModel()
    results = model.scan_all_meetings(hours_ahead=72)
    print_report(results)

    if model._logged_in:
        print(f"\n  Betfair balance: ${model.get_balance():,.2f} AUD")

    # Auto-bet in dry run mode
    overlays = [r for r in results if r['verdict'] == 'OVERLAY']
    if overlays:
        print(f"\n  {'='*70}")
        print(f"  AUTO-BET (DRY RUN) — Top 5 overlays")
        bets = auto_bet(results, max_bets=5, stake=20, dry_run=True)
        print(f"\n  {len(bets)} bets would be placed (${20 * len(bets):.0f} total stake)")
