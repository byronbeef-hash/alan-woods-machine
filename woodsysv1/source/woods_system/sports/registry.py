"""
Woods System — Sport Adapter Registry

Maps sport keys to adapter classes and provides active adapter lookup.
"""

import os
import sys
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from .base import SportAdapter

log = logging.getLogger("woods.registry")

# Lazy imports to avoid circular dependencies and optional deps
_ADAPTER_MAP: dict[str, type] = {}


def _ensure_registered():
    """Register adapters on first use."""
    global _ADAPTER_MAP
    if _ADAPTER_MAP:
        return

    from .nba import NBAAdapter
    from .soccer import SoccerAdapter
    from .nfl import NFLAdapter

    _ADAPTER_MAP = {
        "basketball_nba": NBAAdapter,
        "soccer_epl": SoccerAdapter,
        "soccer_uefa_champions_league": SoccerAdapter,
        "americanfootball_nfl": NFLAdapter,
    }


def get_adapter(sport_key: str) -> SportAdapter | None:
    """Get an adapter instance for a sport key."""
    _ensure_registered()
    cls = _ADAPTER_MAP.get(sport_key)
    if cls is None:
        log.warning(f"No adapter registered for sport: {sport_key}")
        return None

    # SoccerAdapter takes sport_key in constructor
    if sport_key.startswith("soccer_"):
        return cls(sport_key=sport_key)
    return cls()


def get_active_adapters() -> list[SportAdapter]:
    """
    Get adapter instances for all active sports.
    Reads active_sports from Supabase config, falls back to NBA only.
    """
    _ensure_registered()

    try:
        from database import Database
        db = Database()
        active_sports = db.get_config("active_sports", ["basketball_nba"])
        if isinstance(active_sports, str):
            import json
            active_sports = json.loads(active_sports)
    except Exception:
        active_sports = ["basketball_nba"]

    adapters = []
    for sport_key in active_sports:
        adapter = get_adapter(sport_key)
        if adapter:
            adapters.append(adapter)
        else:
            log.warning(f"Skipping unknown sport: {sport_key}")

    if not adapters:
        log.warning("No active sports configured — defaulting to NBA")
        adapters = [get_adapter("basketball_nba")]

    return adapters


def get_all_sport_keys() -> list[str]:
    """Get all registered sport keys."""
    _ensure_registered()
    return list(_ADAPTER_MAP.keys())
