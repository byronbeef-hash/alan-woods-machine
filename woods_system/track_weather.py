"""
Woods System — Track Condition & Weather Integration

Adds critical missing factors to the 8-factor model:
- Track condition (Good/Soft/Heavy) from FormFav API
- Weather forecast from Open-Meteo BOM API
- Runner performance on specific track conditions
- First-up / second-up statistics

Data sources:
- FormFav API (free tier): track condition, runner stats by condition
- Open-Meteo BOM API (free, no key): rainfall, temperature by coordinates
"""

import os
import requests
from datetime import datetime, timezone
from functools import lru_cache

FORMFAV_API_KEY = os.environ.get('FORMFAV_API_KEY', '')
FORMFAV_BASE = 'https://api.formfav.com/v1'

# Australian racecourse coordinates (lat, lon) for weather lookup
TRACK_COORDS = {
    'randwick': (-33.90, 151.24), 'rosehill': (-33.82, 151.02),
    'canterbury': (-33.91, 151.11), 'warwick farm': (-33.91, 150.94),
    'flemington': (-37.79, 144.91), 'caulfield': (-37.88, 145.02),
    'moonee valley': (-37.77, 144.93), 'sandown': (-37.93, 145.17),
    'eagle farm': (-27.43, 153.07), 'doomben': (-27.43, 153.07),
    'sunshine coast': (-26.68, 153.05), 'gold coast': (-28.02, 153.40),
    'morphettville': (-34.97, 138.54), 'murray bridge': (-35.12, 139.27),
    'ascot': (-31.93, 115.93), 'belmont': (-31.95, 115.94),
    'pinjarra': (-32.63, 115.87), 'bunbury': (-33.33, 115.64),
    'newcastle': (-32.93, 151.78), 'gosford': (-33.43, 151.34),
    'kembla grange': (-34.47, 150.82), 'wyong': (-33.28, 151.42),
    'hawkesbury': (-33.62, 150.75), 'bathurst': (-33.42, 149.58),
    'ballina': (-28.87, 153.57), 'grafton': (-29.69, 152.93),
    'port macquarie': (-31.43, 152.91), 'tamworth': (-31.10, 150.93),
    'ararat': (-37.28, 142.93), 'ballarat': (-37.56, 143.86),
    'bendigo': (-36.76, 144.28), 'geelong': (-38.15, 144.36),
    'yarra valley': (-37.75, 145.48), 'cranbourne': (-38.10, 145.28),
    'moe': (-38.18, 146.26), 'pakenham': (-38.07, 145.47),
    'rockhampton': (-23.38, 150.51), 'townsville': (-19.27, 146.81),
    'mackay': (-21.14, 149.19), 'cairns': (-16.92, 145.77),
    'toowoomba': (-27.56, 151.95), 'ipswich': (-27.61, 152.76),
    'marburg': (-27.57, 152.60), 'hobart': (-42.88, 147.33),
    'launceston': (-41.45, 147.14), 'devonport': (-41.18, 146.36),
    'darwin': (-12.46, 130.84), 'alice springs': (-23.70, 133.88),
    'globe derby': (-34.80, 138.60), 'goulburn': (-34.75, 149.72),
    'scone': (-32.05, 150.87), 'mudgee': (-32.59, 149.59),
    'dubbo': (-32.24, 148.60), 'orange': (-33.28, 149.10),
}

# Track condition impact on different runner types
# Wet track specialists vs dry track runners
CONDITION_MULTIPLIERS = {
    # (condition_rating, has_wet_form) -> factor
    # Firm/Good (1-4): dry specialists thrive
    'Firm 1': 1.0, 'Firm 2': 1.0, 'Good 3': 1.0, 'Good 4': 1.0,
    # Soft (5-7): slight advantage to wet trackers
    'Soft 5': 0.98, 'Soft 6': 0.96, 'Soft 7': 0.94,
    # Heavy (8-10): major advantage to proven wet trackers, big penalty to untested
    'Heavy 8': 0.90, 'Heavy 9': 0.87, 'Heavy 10': 0.84,
}

# If a runner has proven wet track form, they get a BONUS on soft/heavy
WET_FORM_BONUS = {
    'Soft 5': 1.04, 'Soft 6': 1.06, 'Soft 7': 1.08,
    'Heavy 8': 1.10, 'Heavy 9': 1.12, 'Heavy 10': 1.15,
}


class TrackWeatherService:
    """Fetches track conditions and weather for race meetings."""

    def __init__(self):
        self.api_key = FORMFAV_API_KEY
        self._cache: dict = {}

    # ------------------------------------------------------------------
    # FormFav API
    # ------------------------------------------------------------------

    def get_meeting_conditions(self, venue_slug: str, date: str) -> dict:
        """Get track condition and weather for a meeting from FormFav."""
        cache_key = f'{venue_slug}_{date}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        if not self.api_key:
            return {'condition': None, 'weather': None, 'runners': {}}

        try:
            # Get race 1 to find meeting conditions
            resp = requests.get(
                f'{FORMFAV_BASE}/form',
                params={'date': date, 'track': venue_slug, 'race': 1},
                headers={'X-API-Key': self.api_key},
                timeout=10,
            )
            if resp.status_code != 200:
                return {'condition': None, 'weather': None, 'runners': {}}

            data = resp.json()
            result = {
                'condition': data.get('condition'),  # e.g. "Soft 6"
                'weather': data.get('weather'),      # e.g. "Fine"
                'distance': data.get('distance'),
                'race_class': data.get('raceClass'),
                'prize_money': data.get('prizeMoney'),
                'runners': {},
            }

            # Extract per-runner stats
            for runner in data.get('runners', []):
                if not runner:
                    continue
                name = runner.get('name', '')
                stats = runner.get('stats') or {}
                result['runners'][name] = {
                    'track_stats': stats.get('track'),        # win% at this track
                    'distance_stats': stats.get('distance'),  # win% at this distance
                    'condition_stats': stats.get('condition'), # win% on this going
                    'first_up': stats.get('firstUp'),
                    'second_up': stats.get('secondUp'),
                    'overall': stats.get('overall'),
                    'gear_change': runner.get('gearChange'),
                    'last20': runner.get('last20Starts'),
                }

            self._cache[cache_key] = result
            return result

        except Exception as e:
            print(f'  [FormFav] Error fetching {venue_slug} {date}: {e}')
            return {'condition': None, 'weather': None, 'runners': {}}

    def get_race_form(self, venue_slug: str, date: str, race_num: int) -> dict:
        """Get detailed form for a specific race from FormFav."""
        if not self.api_key:
            return {}

        try:
            resp = requests.get(
                f'{FORMFAV_BASE}/form',
                params={'date': date, 'track': venue_slug, 'race': race_num},
                headers={'X-API-Key': self.api_key},
                timeout=10,
            )
            if resp.status_code != 200:
                return {}
            return resp.json()
        except Exception as e:
            print(f'  [FormFav] Error fetching R{race_num} {venue_slug}: {e}')
            return {}

    # ------------------------------------------------------------------
    # BOM Weather (via Open-Meteo — free, no API key)
    # ------------------------------------------------------------------

    def get_weather_forecast(self, venue: str, race_time: str = None) -> dict:
        """Get weather forecast for a venue using Open-Meteo BOM API."""
        venue_lower = venue.lower().strip()
        coords = TRACK_COORDS.get(venue_lower)

        if not coords:
            # Try fuzzy match
            for track, c in TRACK_COORDS.items():
                if track in venue_lower or venue_lower in track:
                    coords = c
                    break

        if not coords:
            return {'rain_mm': 0, 'temperature': 20, 'humidity': 50, 'source': 'default'}

        try:
            resp = requests.get(
                'https://api.open-meteo.com/v1/bom',
                params={
                    'latitude': coords[0],
                    'longitude': coords[1],
                    'hourly': 'temperature_2m,relative_humidity_2m,precipitation,rain',
                    'timezone': 'Australia/Brisbane',
                    'forecast_days': 2,
                },
                timeout=10,
            )
            data = resp.json()
            hourly = data.get('hourly', {})
            times = hourly.get('time', [])
            temps = hourly.get('temperature_2m', [])
            humidity = hourly.get('relative_humidity_2m', [])
            rain = hourly.get('rain', [])
            precip = hourly.get('precipitation', [])

            if not times:
                return {'rain_mm': 0, 'temperature': 20, 'humidity': 50, 'source': 'no_data'}

            # If we have a race time, find the closest hour
            if race_time:
                try:
                    target = datetime.fromisoformat(race_time.replace('Z', '+00:00'))
                    target_str = target.strftime('%Y-%m-%dT%H:00')
                    idx = next((i for i, t in enumerate(times) if t >= target_str), len(times) // 2)
                except Exception:
                    idx = len(times) // 2
            else:
                # Use midday
                idx = min(12, len(times) - 1)

            # Sum rain in the 6 hours before race (filter None values)
            rain_start = max(0, idx - 6)
            total_rain = sum(r for r in rain[rain_start:idx + 1] if r is not None) if rain else 0
            total_precip = sum(p for p in precip[rain_start:idx + 1] if p is not None) if precip else 0

            return {
                'rain_mm': round(max(total_rain, total_precip), 1),
                'temperature': round(temps[idx], 1) if idx < len(temps) else 20,
                'humidity': round(humidity[idx]) if idx < len(humidity) else 50,
                'rain_6h': round(total_rain, 1),
                'source': 'bom',
            }

        except Exception as e:
            print(f'  [Weather] Error for {venue}: {e}')
            return {'rain_mm': 0, 'temperature': 20, 'humidity': 50, 'source': 'error'}

    # ------------------------------------------------------------------
    # Model factors
    # ------------------------------------------------------------------

    def calculate_track_condition_factor(self, condition: str, runner_name: str,
                                          runner_stats: dict = None) -> dict:
        """
        Factor 9: Track condition adjustment.

        Penalises runners with no wet form on soft/heavy tracks.
        Rewards runners with proven wet form.
        """
        if not condition:
            return {'factor': 1.0, 'detail': 'No track condition data', 'condition': 'Unknown'}

        # Base penalty for the condition
        base = CONDITION_MULTIPLIERS.get(condition, 1.0)

        # Check if runner has wet track form
        has_wet_form = False
        wet_win_pct = 0
        if runner_stats and runner_stats.get('condition_stats'):
            cond_stats = runner_stats['condition_stats']
            if cond_stats.get('starts', 0) > 0:
                has_wet_form = True
                wet_win_pct = cond_stats.get('winPercent', 0)

        # Apply wet form bonus
        factor = base
        detail = f'Track: {condition}'

        if condition.startswith(('Soft', 'Heavy')):
            if has_wet_form and wet_win_pct > 0:
                bonus = WET_FORM_BONUS.get(condition, 1.0)
                factor = base * bonus
                detail = f'{condition} — proven wet tracker ({wet_win_pct:.0f}% win rate on similar going)'
            else:
                detail = f'{condition} — no wet form on record, penalised'
        else:
            detail = f'{condition} — standard conditions'

        return {
            'factor': round(factor, 3),
            'detail': detail,
            'condition': condition,
            'has_wet_form': has_wet_form,
            'wet_win_pct': wet_win_pct,
        }

    def calculate_weather_factor(self, weather: dict) -> dict:
        """
        Factor 10: Weather-based adjustment.

        Heavy rain before a race degrades track conditions and
        favours front-runners (less kickback).
        """
        rain = weather.get('rain_mm', 0)
        humidity = weather.get('humidity', 50)

        if rain > 10:
            factor = 0.95  # Heavy rain — conditions will deteriorate
            detail = f'{rain}mm rain forecast — track will deteriorate, favours wet-trackers'
        elif rain > 5:
            factor = 0.98
            detail = f'{rain}mm rain — conditions may soften'
        elif rain > 1:
            factor = 0.99
            detail = f'{rain}mm light rain — minor impact'
        else:
            factor = 1.0
            detail = 'Dry conditions — no weather adjustment'

        return {
            'factor': round(factor, 3),
            'detail': detail,
            'rain_mm': rain,
            'temperature': weather.get('temperature', 20),
            'humidity': humidity,
        }

    def calculate_track_stats_factor(self, runner_stats: dict = None) -> dict:
        """
        Factor 11: Track/distance specialist adjustment.

        Rewards runners proven at this specific track.
        """
        if not runner_stats:
            return {'factor': 1.0, 'detail': 'No track stats available'}

        track_stats = runner_stats.get('track_stats')
        if not track_stats or track_stats.get('starts', 0) < 2:
            return {'factor': 1.0, 'detail': 'Insufficient track history'}

        win_pct = track_stats.get('winPercent', 0)
        place_pct = track_stats.get('placePercent', 0)
        starts = track_stats.get('starts', 0)

        if win_pct > 30 and starts >= 3:
            factor = 1.08
            detail = f'Track specialist: {win_pct:.0f}% wins from {starts} starts at this track'
        elif win_pct > 20:
            factor = 1.04
            detail = f'Good track record: {win_pct:.0f}% wins from {starts} starts'
        elif place_pct > 50:
            factor = 1.02
            detail = f'Consistent at track: {place_pct:.0f}% place rate from {starts} starts'
        elif win_pct == 0 and starts >= 4:
            factor = 0.95
            detail = f'Poor track record: 0 wins from {starts} starts'
        else:
            factor = 1.0
            detail = f'Average track record: {win_pct:.0f}% from {starts} starts'

        return {'factor': round(factor, 3), 'detail': detail}

    def calculate_gear_change_factor(self, gear_change: str = None) -> dict:
        """
        Factor 12: Gear change adjustment.

        First-time blinkers and tongue ties have statistically significant
        impact on performance.
        """
        if not gear_change:
            return {'factor': 1.0, 'detail': 'No gear changes'}

        gear_lower = gear_change.lower()
        factor = 1.0
        details = []

        if 'blinkers first time' in gear_lower:
            factor *= 1.06  # First-time blinkers = ~6% improvement historically
            details.append('Blinkers FIRST TIME (+6%)')
        elif 'blinkers off' in gear_lower:
            factor *= 0.97
            details.append('Blinkers removed')

        if 'tongue tie first time' in gear_lower:
            factor *= 1.04
            details.append('Tongue tie FIRST TIME (+4%)')

        if 'winkers first time' in gear_lower:
            factor *= 1.03
            details.append('Winkers FIRST TIME (+3%)')

        if 'cross-over noseband first time' in gear_lower:
            factor *= 1.02
            details.append('Cross-over noseband FIRST TIME')

        detail = ', '.join(details) if details else 'No significant gear changes'
        return {'factor': round(factor, 3), 'detail': detail, 'gear': gear_change}
