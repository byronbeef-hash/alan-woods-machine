"""
Woods System — Racing Australia Track Condition Scraper

Scrapes official track conditions, rail positions, and rainfall data
from racingaustralia.horse for all Australian states.

Data includes:
- Track condition rating (Firm 1 → Heavy 10)
- Weather at venue
- Rail position (True, +2m, etc.)
- Rainfall last 24h and last 7 days
- Penetrometer reading (where available)
- Surface type (Turf, Synthetic)

This fills critical gaps in the 12-factor model that Betfair and
FormFav don't provide — particularly rail position and rainfall history.
"""

import re
import requests
from datetime import datetime
from typing import Optional


STATES = {
    'NSW': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=NSW',
    'VIC': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=VIC',
    'QLD': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=QLD',
    'WA': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=WA',
    'SA': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=SA',
    'TAS': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=TAS',
    'NT': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=NT',
    'ACT': 'https://racingaustralia.horse/InteractiveForm/TrackCondition.aspx?State=ACT',
}


class RacingAustraliaScraper:
    """Scrapes track conditions from Racing Australia's official site."""

    def __init__(self):
        self._cache: dict = {}
        self._session = requests.Session()
        self._session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        })

    def get_all_track_conditions(self) -> list[dict]:
        """Scrape track conditions for all states."""
        all_conditions = []
        for state, url in STATES.items():
            try:
                conditions = self._scrape_state(state, url)
                all_conditions.extend(conditions)
            except Exception as e:
                print(f'  [RA] Error scraping {state}: {e}')
        return all_conditions

    def get_track_condition(self, venue: str) -> Optional[dict]:
        """Get track condition for a specific venue."""
        venue_lower = venue.lower().strip()

        # Check cache first
        if venue_lower in self._cache:
            return self._cache[venue_lower]

        # Scrape all states and find the venue
        all_conditions = self.get_all_track_conditions()
        for cond in all_conditions:
            track_lower = cond['track'].lower()
            self._cache[track_lower] = cond
            if track_lower == venue_lower or venue_lower in track_lower or track_lower in venue_lower:
                return cond

        return None

    def _scrape_state(self, state: str, url: str) -> list[dict]:
        """Scrape track conditions for a single state."""
        try:
            resp = self._session.get(url, timeout=15)
            resp.raise_for_status()
            html = resp.text
        except Exception as e:
            print(f'  [RA] Failed to fetch {state}: {e}')
            return []

        return self._parse_html(html, state)

    def _parse_html(self, html: str, state: str) -> list[dict]:
        """Parse Racing Australia track condition HTML."""
        conditions = []

        # Extract table rows — each meeting has date, track, surface, condition, etc.
        # The HTML structure uses <td> elements in a tabular layout
        rows = re.findall(r'<td[^>]*>(.*?)</td>', html, re.DOTALL)
        clean = [re.sub(r'<[^>]+>', '', r).strip() for r in rows if r.strip()]

        # Parse the data — format varies by state but generally:
        # Date+Track | Surface | Condition | Weather | Rail | Rainfall | Penetrometer
        i = 0
        current_entry = {}

        while i < len(clean):
            cell = clean[i].strip()

            # Look for date patterns like "Mon 24-Mar" or "Tue 25-Mar"
            date_match = re.match(r'(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d+-\w+)', cell)
            if date_match:
                # Save previous entry
                if current_entry.get('track'):
                    conditions.append(current_entry)

                # Start new entry
                current_entry = {
                    'date': cell,
                    'state': state,
                    'track': '',
                    'surface': '',
                    'condition': '',
                    'weather': '',
                    'rail': '',
                    'rainfall_24h': '',
                    'rainfall_7d': '',
                    'penetrometer': '',
                    'updated': '',
                }

                # Next cells should be track name
                if i + 1 < len(clean):
                    track_cell = clean[i + 1]
                    # Track name comes after the date in the same row
                    current_entry['track'] = track_cell
                    i += 1

            elif cell in ('Turf', 'Synthetic', 'All Weather', 'Dirt'):
                current_entry['surface'] = cell

            elif re.match(r'(Firm|Good|Soft|Heavy|Slow|Fast)\s*\d*', cell):
                current_entry['condition'] = cell

            elif cell in ('Fine', 'Overcast', 'Cloudy', 'Rain', 'Showers', 'Hot', 'Warm', 'Cool', 'Cold'):
                current_entry['weather'] = cell

            elif re.match(r'(\+?\d+\.?\d*m|True|Rail)', cell, re.IGNORECASE):
                current_entry['rail'] = cell

            elif 'last 24hrs' in cell.lower() or 'last 7 days' in cell.lower():
                if '24hrs' in cell.lower() or '24 hrs' in cell.lower():
                    current_entry['rainfall_24h'] = cell
                if '7 days' in cell.lower():
                    current_entry['rainfall_7d'] = cell

            elif 'nil' in cell.lower() and ('24' in cell or '7 day' in cell.lower()):
                if '24' in cell:
                    current_entry['rainfall_24h'] = cell
                else:
                    current_entry['rainfall_7d'] = cell

            elif re.match(r'Updated', cell, re.IGNORECASE):
                current_entry['updated'] = cell

            i += 1

        # Save last entry
        if current_entry.get('track'):
            conditions.append(current_entry)

        return conditions

    def get_condition_factor(self, venue: str) -> dict:
        """
        Get track condition data and compute a model factor.

        Returns dict with condition, weather, rail, rainfall, and a
        computed factor for the model.
        """
        data = self.get_track_condition(venue)
        if not data:
            return {
                'condition': None,
                'weather': None,
                'rail': None,
                'rainfall_24h': None,
                'rainfall_7d': None,
                'factor': 1.0,
                'source': 'no_data',
            }

        # Parse condition rating number
        condition = data.get('condition', '')
        rating = self._parse_condition_rating(condition)

        # Parse rainfall
        rain_24h = self._parse_rainfall(data.get('rainfall_24h', ''))
        rain_7d = self._parse_rainfall(data.get('rainfall_7d', ''))

        # Compute factor based on how much the track deviates from Good
        # Good 3-4 = baseline (1.0)
        # Soft 5-7 = increasing uncertainty
        # Heavy 8-10 = high uncertainty, favours wet-trackers
        if rating is not None:
            if rating <= 4:
                factor = 1.0  # Good or better — no adjustment
            elif rating <= 5:
                factor = 0.99  # Soft 5 — minor impact
            elif rating <= 6:
                factor = 0.97  # Soft 6
            elif rating <= 7:
                factor = 0.95  # Soft 7
            elif rating <= 8:
                factor = 0.92  # Heavy 8
            elif rating <= 9:
                factor = 0.89  # Heavy 9
            else:
                factor = 0.85  # Heavy 10
        else:
            factor = 1.0

        return {
            'condition': condition,
            'condition_rating': rating,
            'weather': data.get('weather', ''),
            'rail': data.get('rail', ''),
            'surface': data.get('surface', ''),
            'rainfall_24h': rain_24h,
            'rainfall_7d': rain_7d,
            'factor': round(factor, 3),
            'source': 'racing_australia',
            'updated': data.get('updated', ''),
            'state': data.get('state', ''),
        }

    @staticmethod
    def _parse_condition_rating(condition: str) -> Optional[int]:
        """Extract numeric rating from condition string like 'Soft 6'."""
        if not condition:
            return None
        match = re.search(r'(\d+)', condition)
        return int(match.group(1)) if match else None

    @staticmethod
    def _parse_rainfall(text: str) -> float:
        """Extract mm value from rainfall text like 'Nil last 24hrs, 33mm last 7 days'."""
        if not text:
            return 0.0
        # Find mm values
        matches = re.findall(r'([\d.]+)\s*mm', text)
        if matches:
            return sum(float(m) for m in matches)
        if 'nil' in text.lower():
            return 0.0
        return 0.0


# Quick test
if __name__ == '__main__':
    scraper = RacingAustraliaScraper()

    print('=== Scraping QLD track conditions ===')
    conditions = scraper._scrape_state('QLD', STATES['QLD'])
    for c in conditions:
        print(f"  {c['date']:20s} {c['track']:20s} {c['surface']:12s} {c['condition']:10s} {c['weather']:10s} Rail: {c['rail']}")

    print('\n=== Lookup specific venue ===')
    result = scraper.get_condition_factor('Rockhampton')
    for k, v in result.items():
        print(f'  {k}: {v}')
