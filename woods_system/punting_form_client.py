"""
Punting Form API Client
https://docs.puntingform.com.au/reference/meetingslist

Provides speed ratings, sectional times, speedmaps, track conditions,
and strike rates — the core data that transforms our model from
8-factor guessing to 20-factor precision.

API key required: Set PUNTING_FORM_API_KEY in .env
"""
import os
import requests
from datetime import datetime
from typing import Optional

BASE_URL = "https://api.puntingform.com.au/v2/form"

class PuntingFormClient:
    def __init__(self):
        self.api_key = os.getenv('PUNTING_FORM_API_KEY', '')
        self.enabled = bool(self.api_key)
        if not self.enabled:
            print("  [PuntingForm] No API key configured. Set PUNTING_FORM_API_KEY in .env")

    def _get(self, endpoint: str, params: dict = None) -> dict:
        """Make authenticated GET request."""
        if not self.enabled:
            return {}
        p = {'apiKey': self.api_key, **(params or {})}
        try:
            resp = requests.get(f"{BASE_URL}/{endpoint}", params=p, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            print(f"  [PuntingForm] Error calling {endpoint}: {e}")
            return {}

    def get_meetings(self, date: str) -> list:
        """Get all meetings for a date. Date format: YYYY-MM-DD"""
        data = self._get('meetingslist', {'date': date})
        return data.get('meetings', []) if data else []

    def get_fields(self, meeting_id: str, race_number: int) -> dict:
        """Get full field for a race including runner details."""
        return self._get('fields', {'meetingId': meeting_id, 'raceNumber': str(race_number)})

    def get_ratings(self, meeting_id: str) -> list:
        """Get speed ratings for all races in a meeting.
        Returns per-runner speed rating (Timeform-style normalised speed).
        This is the #1 most important data point for the model."""
        data = self._get('meetingratings', {'meetingId': meeting_id})
        return data.get('ratings', []) if data else []

    def get_sectionals(self, meeting_id: str) -> list:
        """Get sectional times (last 600m, 400m, 200m splits).
        Identifies true finishing ability vs flattered form."""
        data = self._get('meetingsectionals', {'meetingId': meeting_id})
        return data.get('sectionals', []) if data else []

    def get_speedmaps(self, meeting_id: str) -> list:
        """Get predicted running positions for all races.
        Shows pace scenario: leaders vs stalkers vs closers."""
        # Note: speedmaps endpoint may be under /form/speedmaps
        data = self._get('speedmaps', {'meetingId': meeting_id})
        return data.get('speedmaps', []) if data else []

    def get_benchmarks(self, meeting_id: str) -> list:
        """Get class benchmarks — is horse rising or dropping in class?"""
        data = self._get('meetingbenchmarks', {'meetingId': meeting_id})
        return data.get('benchmarks', []) if data else []

    def get_conditions(self) -> list:
        """Get current track conditions for all meetings today.
        Official ratings: Good 1-4, Soft 5-7, Heavy 8-10."""
        data = self._get('conditions')
        return data.get('conditions', []) if data else []

    def get_scratchings(self) -> list:
        """Get late scratchings — CRITICAL: don't bet on scratched horses."""
        data = self._get('scratchings')
        return data.get('scratchings', []) if data else []

    def get_strike_rates(self, meeting_id: str) -> list:
        """Get jockey/trainer strike rates at venue and distance.
        Replaces hardcoded elite lists with actual performance data."""
        data = self._get('strikerate-1', {'meetingId': meeting_id})
        return data.get('strikeRates', []) if data else []

    def get_form(self, meeting_id: str) -> list:
        """Get detailed form for all runners in a meeting.
        Full run-by-run analysis instead of 5-char form string."""
        data = self._get('form-1', {'meetingId': meeting_id})
        return data.get('form', []) if data else []

    def enrich_runner(self, runner: dict, meeting_id: str, race_number: int) -> dict:
        """Enrich a runner dict with Punting Form data.
        Called from horse_racing_model.py during scan.

        Adds:
        - speed_rating: normalised speed (0-120 scale)
        - sectional_last600: last 600m split time
        - pace_position: predicted running position (1=leader)
        - class_benchmark: class rating for this race
        - jockey_strike_rate: win % at venue/distance
        - trainer_strike_rate: win % at venue/distance
        - track_condition_official: official track rating
        """
        if not self.enabled:
            return runner

        # TODO: Implement when API key is available
        # ratings = self.get_ratings(meeting_id)
        # sectionals = self.get_sectionals(meeting_id)
        # speedmaps = self.get_speedmaps(meeting_id)
        # benchmarks = self.get_benchmarks(meeting_id)
        # strike_rates = self.get_strike_rates(meeting_id)

        return runner
