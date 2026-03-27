"""
Racing Australia FreeFields Scraper
====================================
Scrapes official race fields, form, track conditions, and handicap ratings
from racingaustralia.horse — free, no login required.

Data fields per runner:
  - number, horse, form (last 10), trainer, jockey
  - barrier, weight, handicap_rating
  - track_condition, rail_position, weather, track_type

This replaces the need for Punting Form ($297/mo) for core form data.
"""

import re
import logging
import requests
from datetime import datetime, timedelta
from typing import Optional
from bs4 import BeautifulSoup

log = logging.getLogger("woods")

BASE_URL = "https://racingaustralia.horse/FreeFields"
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS"]

# Venue coordinate map for weather lookups
VENUE_COORDS = {
    "rosehill": (-33.82, 151.02), "randwick": (-33.90, 151.24),
    "flemington": (-37.79, 144.91), "caulfield": (-37.88, 145.02),
    "sandown": (-37.91, 145.17), "moonee valley": (-37.77, 144.93),
    "morphettville": (-34.97, 138.55), "doomben": (-27.43, 153.07),
    "eagle farm": (-27.43, 153.08), "gold coast": (-28.00, 153.43),
    "warwick farm": (-33.91, 150.94), "canterbury": (-33.91, 151.11),
    "wyong": (-33.28, 151.42), "newcastle": (-32.93, 151.78),
    "kembla grange": (-34.46, 150.82), "gosford": (-33.43, 151.34),
    "port macquarie": (-31.43, 152.91), "ballarat": (-37.56, 143.85),
    "geelong": (-38.15, 144.36), "sale": (-38.11, 147.07),
    "bendigo": (-36.76, 144.28), "mornington": (-38.22, 145.04),
    "pakenham": (-38.07, 145.49), "cranbourne": (-38.10, 145.28),
    "sunshine coast": (-26.65, 153.07), "ipswich": (-27.62, 152.77),
    "toowoomba": (-27.56, 151.95), "rockhampton": (-23.38, 150.51),
    "townsville": (-19.25, 146.77), "cairns": (-16.92, 145.77),
    "murray bridge": (-35.12, 139.28), "gawler": (-34.60, 138.74),
    "mount gambier": (-37.83, 140.78), "ascot": (-31.93, 115.96),
    "belmont": (-31.95, 116.02), "bunbury": (-33.33, 115.64),
    "kalgoorlie": (-30.75, 121.47),
}


def get_meetings(date: Optional[str] = None, states: Optional[list] = None) -> list:
    """
    Get all thoroughbred meetings for a given date across Australian states.

    Args:
        date: Date string like '2026Mar28' or None for tomorrow
        states: List of state codes or None for all

    Returns:
        List of dicts with keys: date, state, venue, key, url
    """
    states = states or STATES
    meetings = []

    for state in states:
        try:
            url = f"{BASE_URL}/Calendar.aspx?State={state}"
            resp = requests.get(url, headers=HEADERS, timeout=15)

            # Find form guide links
            keys = re.findall(r'Form\.aspx\?Key=([^"\'&\s]+)', resp.text)

            for key in keys:
                decoded = key.replace('%2C', ',').replace('%20', ' ')
                parts = decoded.split(',')
                if len(parts) >= 3 and 'Trial' not in decoded and 'Picnic' not in decoded:
                    venue = parts[2]
                    meeting_date = parts[0]
                    if date and meeting_date != date:
                        continue
                    meetings.append({
                        'date': meeting_date,
                        'state': state,
                        'venue': venue,
                        'key': key,
                        'url': f"{BASE_URL}/Form.aspx?Key={key}",
                    })
        except Exception as e:
            log.warning(f"Error fetching {state} meetings: {e}")

    # Deduplicate
    seen = set()
    unique = []
    for m in meetings:
        k = f"{m['date']}-{m['venue']}"
        if k not in seen:
            seen.add(k)
            unique.append(m)

    return unique


def scrape_meeting(meeting_url: str) -> dict:
    """
    Scrape a complete meeting from Racing Australia FreeFields.

    Returns dict with:
        venue, track_condition, rail_position, weather, track_type,
        races: [{ race_num, field_size, runners: [...] }]
    """
    try:
        resp = requests.get(meeting_url, headers=HEADERS, timeout=30)
        soup = BeautifulSoup(resp.text, 'html.parser')
    except Exception as e:
        log.error(f"Failed to fetch {meeting_url}: {e}")
        return {}

    text = soup.get_text()

    # Extract track info
    tc_match = re.search(
        r'Track\s*(?:Condition|Rating)\s*:?\s*((?:Good|Soft|Heavy|Firm|Synthetic)\s*\d*)',
        text, re.I
    )
    track_condition = tc_match.group(1).strip() if tc_match else "Unknown"

    rail_match = re.search(r'Rail\s*(?:Position)?\s*:?\s*([^\n]{3,60})', text, re.I)
    rail_position = rail_match.group(1).strip() if rail_match else "Unknown"

    weather_match = re.search(r'Weather\s*:?\s*(\w+)', text, re.I)
    weather = weather_match.group(1).strip() if weather_match else "Unknown"

    track_type_match = re.search(r'Track\s*Type\s*:?\s*(\w+)', text, re.I)
    track_type = track_type_match.group(1).strip() if track_type_match else "Turf"

    venue_match = re.search(r'<h2[^>]*>([^<]+)</h2>', resp.text, re.I)
    venue = venue_match.group(1).strip() if venue_match else "Unknown"

    # Parse race field tables
    field_tables = soup.find_all('table', class_='race-strip-fields')

    races = []
    for i, table in enumerate(field_tables):
        race_num = i + 1
        rows = table.find_all('tr')

        runners = []
        for row in rows[1:]:  # skip header
            cells = row.find_all('td')
            if len(cells) < 7:
                continue

            number = cells[0].get_text(strip=True)
            if not number.isdigit():
                continue

            form_str = cells[1].get_text(strip=True)
            horse = cells[2].get_text(strip=True)
            trainer = cells[3].get_text(strip=True)
            jockey_raw = cells[4].get_text(strip=True)
            barrier = cells[5].get_text(strip=True)
            weight_raw = cells[6].get_text(strip=True)
            hcp_rating = cells[9].get_text(strip=True) if len(cells) > 9 else ""

            jockey = re.sub(r'\(.*?\)', '', jockey_raw).strip()

            claim_match = re.search(r'\(a(\d+\.?\d*)', jockey_raw)
            apprentice_claim = float(claim_match.group(1)) if claim_match else 0

            weight = float(re.search(r'(\d+\.?\d*)', weight_raw).group(1)) if re.search(r'(\d+\.?\d*)', weight_raw) else 0

            hcp = int(hcp_rating) if hcp_rating.isdigit() else 0

            form_analysis = _analyse_form(form_str)

            runners.append({
                'number': int(number),
                'horse': horse,
                'form': form_str,
                'form_analysis': form_analysis,
                'trainer': trainer,
                'jockey': jockey,
                'apprentice_claim': apprentice_claim,
                'barrier': int(barrier) if barrier.isdigit() else 0,
                'weight': weight,
                'hcp_rating': hcp,
            })

        if runners:
            races.append({
                'race_num': race_num,
                'runners': runners,
                'field_size': len(runners),
            })

    return {
        'venue': venue,
        'track_condition': track_condition,
        'rail_position': rail_position,
        'weather': weather,
        'track_type': track_type,
        'races': races,
        'total_runners': sum(r['field_size'] for r in races),
    }


def _analyse_form(form_str: str) -> dict:
    """
    Deep analysis of a form string (last 10 starts).
    Returns metrics that feed into the model.
    """
    if not form_str:
        return {'runs': 0, 'wins': 0, 'places': 0, 'win_pct': 0, 'place_pct': 0,
                'avg_finish': 0, 'last_start': 0, 'trend': 0, 'consistency': 0}

    runs = []
    for ch in form_str:
        if ch.isdigit():
            runs.append(int(ch))
        elif ch == 'x':
            runs.append(10)

    if not runs:
        return {'runs': 0, 'wins': 0, 'places': 0, 'win_pct': 0, 'place_pct': 0,
                'avg_finish': 0, 'last_start': 0, 'trend': 0, 'consistency': 0}

    n = len(runs)
    wins = sum(1 for r in runs if r == 1)
    places = sum(1 for r in runs if r <= 3)
    avg_finish = sum(runs) / n
    last_start = runs[-1] if runs else 0

    if n >= 6:
        recent = sum(runs[-3:]) / 3
        older = sum(runs[:3]) / 3
        trend = older - recent
    elif n >= 2:
        trend = runs[0] - runs[-1]
    else:
        trend = 0

    if n >= 2:
        mean = avg_finish
        consistency = (sum((r - mean) ** 2 for r in runs) / n) ** 0.5
    else:
        consistency = 0

    return {
        'runs': n,
        'wins': wins,
        'places': places,
        'win_pct': wins / n if n > 0 else 0,
        'place_pct': places / n if n > 0 else 0,
        'avg_finish': round(avg_finish, 2),
        'last_start': last_start,
        'trend': round(trend, 2),
        'consistency': round(consistency, 2),
    }


def get_weather_forecast(venue: str, race_time: Optional[datetime] = None) -> dict:
    """Get weather forecast for a venue using Open-Meteo (free, no auth)."""
    venue_lower = venue.lower().replace(' ', '')

    coords = None
    for key, (lat, lon) in VENUE_COORDS.items():
        if key in venue_lower or venue_lower in key:
            coords = (lat, lon)
            break

    if not coords:
        return {'temperature': None, 'precipitation': None, 'humidity': None}

    try:
        url = (
            f"https://api.open-meteo.com/v1/forecast?"
            f"latitude={coords[0]}&longitude={coords[1]}"
            f"&hourly=precipitation,temperature_2m,relative_humidity_2m"
            f"&forecast_days=3&timezone=Australia%2FSydney"
        )
        resp = requests.get(url, timeout=10)
        data = resp.json()

        hourly = data.get('hourly', {})
        times = hourly.get('time', [])
        precip = hourly.get('precipitation', [])
        temp = hourly.get('temperature_2m', [])
        humidity = hourly.get('relative_humidity_2m', [])

        target = race_time or datetime.now()
        target_str = target.strftime('%Y-%m-%dT%H:00')

        for i, t in enumerate(times):
            if t >= target_str:
                return {
                    'temperature': round(temp[i], 1) if i < len(temp) else None,
                    'precipitation': round(precip[i], 1) if i < len(precip) else None,
                    'humidity': round(humidity[i]) if i < len(humidity) else None,
                }

        return {'temperature': None, 'precipitation': None, 'humidity': None}

    except Exception as e:
        log.debug(f"Weather API error for {venue}: {e}")
        return {'temperature': None, 'precipitation': None, 'humidity': None}


def track_condition_factor(condition: str, form_str: str) -> float:
    """
    Calculate adjustment factor based on track condition.
    Returns: multiplier (0.85 to 1.15)
    """
    rating = 0
    match = re.search(r'(\d+)', condition)
    if match:
        rating = int(match.group(1))
    elif 'good' in condition.lower():
        rating = 3
    elif 'soft' in condition.lower():
        rating = 6
    elif 'heavy' in condition.lower():
        rating = 9
    elif 'firm' in condition.lower():
        rating = 1

    if rating == 0:
        return 1.0

    if rating >= 7:
        return 0.92
    elif rating >= 5:
        return 0.96
    elif rating <= 2:
        return 0.98

    return 1.0


def handicap_rating_factor(hcp_rating: int, field_avg_hcp: float) -> float:
    """
    Calculate adjustment based on handicap rating relative to field average.
    Returns: multiplier (0.90 to 1.12)
    """
    if hcp_rating == 0 or field_avg_hcp == 0:
        return 1.0

    diff = hcp_rating - field_avg_hcp

    if diff > 15:
        return 1.12
    elif diff > 10:
        return 1.08
    elif diff > 5:
        return 1.04
    elif diff > 0:
        return 1.02
    elif diff > -5:
        return 0.98
    elif diff > -10:
        return 0.95
    else:
        return 0.90


def form_depth_factor(form_analysis: dict) -> float:
    """
    Calculate adjustment from deep form analysis (last 10 starts).
    Returns: multiplier (0.85 to 1.20)
    """
    if form_analysis['runs'] == 0:
        return 0.90

    factor = 1.0

    if form_analysis['win_pct'] > 0.3:
        factor *= 1.08
    elif form_analysis['win_pct'] > 0.2:
        factor *= 1.04
    elif form_analysis['win_pct'] == 0:
        factor *= 0.94

    if form_analysis['place_pct'] > 0.5:
        factor *= 1.04
    elif form_analysis['place_pct'] < 0.2:
        factor *= 0.96

    if form_analysis['trend'] > 3:
        factor *= 1.06
    elif form_analysis['trend'] > 1:
        factor *= 1.03
    elif form_analysis['trend'] < -3:
        factor *= 0.94
    elif form_analysis['trend'] < -1:
        factor *= 0.97

    if form_analysis['last_start'] == 1:
        factor *= 1.05
    elif form_analysis['last_start'] <= 3:
        factor *= 1.02
    elif form_analysis['last_start'] >= 8:
        factor *= 0.95

    if form_analysis['consistency'] < 2.0 and form_analysis['avg_finish'] < 4:
        factor *= 1.03

    return round(min(1.20, max(0.85, factor)), 4)


def enrich_betfair_runners(betfair_runners: list, meeting_data: dict) -> list:
    """
    Merge Racing Australia data with Betfair runner data.

    Matches by horse name and adds: hcp_rating, form, form_analysis,
    track_condition_adj, hcp_rating_adj, form_depth_adj
    """
    if not meeting_data or not meeting_data.get('races'):
        return betfair_runners

    ra_lookup = {}
    for race in meeting_data['races']:
        for runner in race['runners']:
            key = _normalise_name(runner['horse'])
            ra_lookup[key] = runner

    track_cond = meeting_data.get('track_condition', '')

    field_hcps = [r['hcp_rating'] for r in ra_lookup.values() if r['hcp_rating'] > 0]
    avg_hcp = sum(field_hcps) / len(field_hcps) if field_hcps else 0

    for bf_runner in betfair_runners:
        name_key = _normalise_name(bf_runner.get('name', ''))
        ra = ra_lookup.get(name_key)

        if ra:
            bf_runner['ra_form'] = ra['form']
            bf_runner['ra_form_analysis'] = ra['form_analysis']
            bf_runner['ra_hcp_rating'] = ra['hcp_rating']
            bf_runner['ra_jockey'] = ra['jockey']
            bf_runner['ra_trainer'] = ra['trainer']
            bf_runner['ra_weight'] = ra['weight']
            bf_runner['ra_barrier'] = ra['barrier']
            bf_runner['ra_apprentice_claim'] = ra['apprentice_claim']

            bf_runner['track_condition_adj'] = track_condition_factor(track_cond, ra['form'])
            bf_runner['hcp_rating_adj'] = handicap_rating_factor(ra['hcp_rating'], avg_hcp)
            bf_runner['form_depth_adj'] = form_depth_factor(ra['form_analysis'])
        else:
            bf_runner['track_condition_adj'] = 1.0
            bf_runner['hcp_rating_adj'] = 1.0
            bf_runner['form_depth_adj'] = 1.0

    return betfair_runners


def _normalise_name(name: str) -> str:
    """Normalise horse name for matching between Betfair and Racing Australia."""
    name = re.sub(r'^\d+\.\s*', '', name)
    name = re.sub(r'\s*\([A-Z]{2,3}\)\s*$', '', name)
    name = name.upper().strip()
    name = re.sub(r'[^A-Z\s]', '', name)
    return name.strip()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    print("=== Racing Australia Scraper Test ===\n")

    meetings = get_meetings()
    print(f"Found {len(meetings)} meetings:\n")
    for m in meetings[:10]:
        print(f"  {m['date']} {m['state']} {m['venue']}")

    if meetings:
        print(f"\nScraping {meetings[0]['venue']}...")
        data = scrape_meeting(meetings[0]['url'])
        if data:
            print(f"  Track: {data['track_condition']}")
            print(f"  Weather: {data['weather']}")
            print(f"  Races: {len(data['races'])}")
            print(f"  Total runners: {data['total_runners']}")

            if data['races']:
                race = data['races'][0]
                print(f"\n  Race {race['race_num']}: {race['field_size']} runners")
                for r in race['runners'][:5]:
                    fa = r['form_analysis']
                    print(f"    {r['number']:>2}. {r['horse']:25s} B{r['barrier']:>2} "
                          f"{r['weight']:>5.1f}kg HCR:{r['hcp_rating']:>3} "
                          f"Form:{r['form']:>12s} "
                          f"W%:{fa['win_pct']:.0%} P%:{fa['place_pct']:.0%} "
                          f"Trend:{fa['trend']:+.1f}")
