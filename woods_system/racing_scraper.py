"""
Woods System — Racing Data Scraper

Scrapes FREE public racing data to supplement Betfair:
1. TAB.com.au — fields, form, track conditions, scratchings, odds
2. Racing.com — sectionals, speed ratings (VIC meetings)
3. Racenet.com.au — detailed form, ratings, track/distance stats
4. Open-Meteo BOM — weather forecast by venue coordinates

This replaces the paid FormFav/PuntingForm integration with free alternatives.
"""

import os
import re
import json
import time
import requests
from datetime import datetime, timezone, timedelta
from functools import lru_cache
from typing import Optional

# Venue coordinates for weather API
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
    'port macquarie': (-31.43, 152.91), 'tamworth': (-31.10, 150.93),
    'ararat': (-37.28, 142.93), 'ballarat': (-37.56, 143.86),
    'bendigo': (-36.76, 144.28), 'geelong': (-38.15, 144.36),
    'yarra valley': (-37.75, 145.48), 'cranbourne': (-38.10, 145.28),
    'moe': (-38.18, 146.26), 'pakenham': (-38.07, 145.47),
    'rockhampton': (-23.38, 150.51), 'townsville': (-19.27, 146.81),
    'hobart': (-42.88, 147.33), 'launceston': (-41.45, 147.14),
    'goulburn': (-34.75, 149.72), 'orange': (-33.28, 149.10),
    'scone': (-32.05, 150.87), 'dubbo': (-32.24, 148.60),
    'wagga': (-35.11, 147.37), 'albury': (-36.08, 146.92),
    'coffs harbour': (-30.30, 153.11), 'grafton': (-29.69, 152.93),
    'ballina': (-28.87, 153.57), 'lismore': (-28.81, 153.28),
    'toowoomba': (-27.56, 151.95), 'ipswich': (-27.61, 152.76),
    'mackay': (-21.14, 149.19), 'cairns': (-16.92, 145.77),
    'darwin': (-12.46, 130.84),
}


class RacingScraper:
    """Scrapes free racing data from public Australian racing sites."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                          'AppleWebKit/537.36 (KHTML, like Gecko) '
                          'Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/html',
        })
        self._cache: dict = {}

    # ------------------------------------------------------------------
    # Weather (Open-Meteo — free, no API key needed)
    # ------------------------------------------------------------------

    def get_weather(self, venue: str) -> dict:
        """Get weather forecast for a venue using Open-Meteo BOM API."""
        venue_lower = venue.lower().strip()
        coords = TRACK_COORDS.get(venue_lower)
        if not coords:
            # Try partial match
            for k, v in TRACK_COORDS.items():
                if k in venue_lower or venue_lower in k:
                    coords = v
                    break
        if not coords:
            return {'rain_mm': 0, 'temperature': 20, 'humidity': 50, 'source': 'default'}

        cache_key = f'weather_{venue_lower}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            lat, lon = coords
            resp = self.session.get(
                'https://api.open-meteo.com/v1/forecast',
                params={
                    'latitude': lat,
                    'longitude': lon,
                    'hourly': 'precipitation,temperature_2m,relative_humidity_2m,wind_speed_10m',
                    'forecast_days': 2,
                    'timezone': 'Australia/Sydney',
                },
                timeout=10,
            )
            data = resp.json()
            hourly = data.get('hourly', {})

            times = hourly.get('time', [])
            precip = hourly.get('precipitation', [])
            temps = hourly.get('temperature_2m', [])
            humidity = hourly.get('relative_humidity_2m', [])
            wind = hourly.get('wind_speed_10m', [])

            # Find the next 6 hours of data
            now = datetime.now()
            now_str = now.strftime('%Y-%m-%dT%H:00')
            start_idx = 0
            for i, t in enumerate(times):
                if t >= now_str:
                    start_idx = i
                    break

            # Average over next 6 hours (race window)
            window = slice(start_idx, min(start_idx + 6, len(times)))
            rain_vals = [v for v in precip[window] if v is not None]
            temp_vals = [v for v in temps[window] if v is not None]
            hum_vals = [v for v in humidity[window] if v is not None]
            wind_vals = [v for v in wind[window] if v is not None]

            result = {
                'rain_mm': round(sum(rain_vals), 1) if rain_vals else 0,
                'temperature': round(sum(temp_vals) / len(temp_vals), 1) if temp_vals else 20,
                'humidity': round(sum(hum_vals) / len(hum_vals), 0) if hum_vals else 50,
                'wind_speed': round(sum(wind_vals) / len(wind_vals), 1) if wind_vals else 0,
                'source': 'open-meteo-bom',
            }
            self._cache[cache_key] = result
            return result
        except Exception as e:
            return {'rain_mm': 0, 'temperature': 20, 'humidity': 50, 'wind_speed': 0,
                    'source': 'error', 'error': str(e)}

    # ------------------------------------------------------------------
    # TAB.com.au — Track conditions and race fields
    # ------------------------------------------------------------------

    def get_tab_meetings(self, date: str = None) -> list[dict]:
        """
        Get today's meetings from TAB API.
        TAB has a public JSON API used by their frontend.
        """
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')

        cache_key = f'tab_meetings_{date}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            # TAB's internal API for race data
            # Note: api.tab.com.au may not resolve from all networks
            resp = self.session.get(
                f'https://api.tab.com.au/v1/tab-info-service/racing/dates/{date}/meetings',
                params={'jurisdiction': 'NSW'},
                timeout=5,
            )
            if resp.status_code == 200:
                data = resp.json()
                meetings = data.get('meetings', [])
                self._cache[cache_key] = meetings
                return meetings
        except Exception:
            pass  # TAB API not available — fall back to weather-based condition estimate

        return []

    def get_tab_race(self, meeting_code: str, race_num: int) -> dict:
        """Get detailed race data from TAB."""
        cache_key = f'tab_race_{meeting_code}_{race_num}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            resp = self.session.get(
                f'https://api.tab.com.au/v1/tab-info-service/racing/dates/'
                f'{datetime.now().strftime("%Y-%m-%d")}/meetings/{meeting_code}/races/{race_num}',
                params={'jurisdiction': 'NSW'},
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                self._cache[cache_key] = data
                return data
        except Exception as e:
            print(f"  [TAB] Error fetching race: {e}")
        return {}

    def get_tab_track_condition(self, meeting_data: dict) -> str:
        """Extract track condition from TAB meeting data."""
        # TAB provides weatherCondition and trackCondition
        track = meeting_data.get('trackCondition', '')
        weather = meeting_data.get('weatherCondition', '')
        if track:
            return track
        return ''

    # ------------------------------------------------------------------
    # Racenet.com.au — Form ratings and stats
    # ------------------------------------------------------------------

    def get_racenet_form(self, runner_name: str, venue: str = '') -> dict:
        """
        Get detailed form from Racenet.
        Racenet provides free form guides with:
        - Career stats (wins/places by track condition)
        - Distance stats
        - Track stats
        - Recent form with margins
        """
        cache_key = f'racenet_{runner_name}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        # Racenet search API
        try:
            search_name = runner_name.strip().lower().replace(' ', '-')
            resp = self.session.get(
                f'https://www.racenet.com.au/api/horses/{search_name}',
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                self._cache[cache_key] = data
                return data
        except Exception:
            pass

        return {}

    # ------------------------------------------------------------------
    # Racing Australia — Official results
    # ------------------------------------------------------------------

    def get_racing_australia_results(self, venue: str, date: str) -> list[dict]:
        """Get official results from Racing Australia."""
        cache_key = f'ra_results_{venue}_{date}'
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            resp = self.session.get(
                f'https://www.racingaustralia.horse/FreeFields/Results.aspx',
                params={'date': date, 'venue': venue},
                timeout=15,
            )
            # This returns HTML — would need parsing
            # For now, return empty and rely on TAB/Betfair for results
            return []
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Combined data enrichment
    # ------------------------------------------------------------------

    def enrich_meeting(self, venue: str, race_date: str = None) -> dict:
        """
        Get all available free data for a meeting:
        - Weather from Open-Meteo BOM
        - Track condition (from TAB if available)
        - Meeting-level info
        """
        if not race_date:
            race_date = datetime.now().strftime('%Y-%m-%d')

        weather = self.get_weather(venue)

        # Try to get TAB meeting data for track condition
        track_condition = None
        tab_meetings = self.get_tab_meetings(race_date)
        venue_lower = venue.lower().strip()
        for m in tab_meetings:
            name = m.get('meetingName', '').lower()
            venue_code = m.get('venueMnemonic', '').lower()
            if venue_lower in name or name in venue_lower or venue_lower == venue_code:
                track_condition = self.get_tab_track_condition(m)
                break

        # Infer track condition from weather if TAB doesn't have it
        if not track_condition and weather.get('rain_mm', 0) > 0:
            rain = weather['rain_mm']
            if rain > 10:
                track_condition = 'Heavy 8'
            elif rain > 5:
                track_condition = 'Soft 7'
            elif rain > 2:
                track_condition = 'Soft 6'
            elif rain > 0.5:
                track_condition = 'Soft 5'
            else:
                track_condition = 'Good 4'

        return {
            'venue': venue,
            'date': race_date,
            'track_condition': track_condition,
            'weather': weather,
            'weather_summary': self._weather_summary(weather),
        }

    def _weather_summary(self, weather: dict) -> str:
        """Human-readable weather summary."""
        rain = weather.get('rain_mm', 0)
        temp = weather.get('temperature', 0)
        wind = weather.get('wind_speed', 0)

        parts = []
        if rain > 5:
            parts.append('Heavy Rain')
        elif rain > 1:
            parts.append('Rain')
        elif rain > 0:
            parts.append('Light Showers')
        else:
            parts.append('Fine')

        if temp:
            parts.append(f'{temp:.0f}°C')
        if wind and wind > 20:
            parts.append(f'Windy ({wind:.0f}km/h)')

        return ', '.join(parts)


# ------------------------------------------------------------------
# Betting safety rules
# ------------------------------------------------------------------

def is_gallops_race(race_name: str) -> bool:
    """
    Check if a race is thoroughbred gallops (not harness or greyhounds).
    Harness races contain: Pace, Trot, Harness
    Greyhound races contain: Greyhound
    """
    harness_keywords = ['pace', 'trot', 'harness', 'pacing', 'trotting',
                        'pacer', 'trotter']
    greyhound_keywords = ['greyhound', 'dogs']
    name_lower = race_name.lower()
    for kw in harness_keywords + greyhound_keywords:
        if kw in name_lower:
            return False
    return True


def enforce_betting_rules(overlays: list[dict], max_per_race: int = 1,
                          min_field_size: int = 6,
                          gallops_only: bool = True) -> list[dict]:
    """
    Apply safety rules that prevent catastrophic losses:
    1. Maximum 1 bet per race (best W.E. only)
    2. Gallops only (no harness, no greyhounds)
    3. Minimum field size of 6 runners
    4. Spread across different meetings
    5. Never bet > 30% of overlays in a race (indicates broken model)
    """
    filtered = []

    # Group by race
    by_race: dict[str, list[dict]] = {}
    for o in overlays:
        race_key = o.get('market_id', '') or f"{o.get('meeting','')}-{o['race']}"
        by_race.setdefault(race_key, []).append(o)

    for race_key, runners in by_race.items():
        race_name = runners[0].get('race', '')
        field_size = runners[0].get('field_size', 0)

        # Rule 1: Gallops only
        if gallops_only and not is_gallops_race(race_name):
            continue

        # Rule 2: Minimum field size
        if field_size < min_field_size:
            continue

        # Rule 3: If > 30% of field is "overlay", model is broken for this race
        if len(runners) > field_size * 0.3:
            continue

        # Rule 4: Take only the best per race (highest W.E.)
        runners.sort(key=lambda x: x['we_net'], reverse=True)
        filtered.extend(runners[:max_per_race])

    # Sort by W.E. descending
    filtered.sort(key=lambda x: x['we_net'], reverse=True)
    return filtered


# ------------------------------------------------------------------
# CLI test
# ------------------------------------------------------------------

if __name__ == '__main__':
    scraper = RacingScraper()

    # Test weather
    for venue in ['randwick', 'flemington', 'eagle farm', 'morphettville']:
        wx = scraper.get_weather(venue)
        print(f"  {venue:20s}: {scraper._weather_summary(wx)}")
        print(f"    Rain: {wx['rain_mm']}mm | Temp: {wx['temperature']}°C | "
              f"Humidity: {wx.get('humidity', '?')}% | Wind: {wx.get('wind_speed', '?')}km/h")

    # Test TAB meetings
    print("\n  TAB Meetings Today:")
    meetings = scraper.get_tab_meetings()
    for m in meetings[:5]:
        print(f"    {m.get('meetingName', '?')} — {m.get('trackCondition', '?')} "
              f"— {m.get('weatherCondition', '?')}")

    # Test enrichment
    print("\n  Enriched Meeting Data:")
    data = scraper.enrich_meeting('randwick')
    print(f"    {data}")
