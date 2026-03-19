"""Updates live Betfair bet status in Supabase every 60 seconds."""
import time
import json
from betfair_client import BetfairClient
from database import Database

def update_bet_status():
    bf = BetfairClient()
    db = Database()
    
    if not bf.login():
        print("Betfair login failed")
        return
    
    orders = bf._betting_call('listCurrentOrders', {})
    current = orders.get('currentOrders', [])
    
    live_bets = []
    for order in current:
        live_bets.append({
            'bet_id': order.get('betId', ''),
            'market_id': order.get('marketId', ''),
            'selection_id': order.get('selectionId', 0),
            'side': order.get('side', ''),
            'price': order.get('price', 0),
            'size': order.get('size', 0),
            'matched': order.get('sizeMatched', 0),
            'remaining': order.get('sizeRemaining', 0),
            'status': order.get('status', ''),
            'placed': order.get('placedDate', ''),
        })
    
    db.client.table('system_config').upsert({
        'key': 'live_betfair_bets',
        'value': live_bets,
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ'),
    }).execute()
    
    matched_total = sum(b['matched'] for b in live_bets)
    unmatched_total = sum(b['remaining'] for b in live_bets)
    print(f"[{time.strftime('%H:%M:%S')}] {len(live_bets)} orders | Matched: ${matched_total:.2f} | Unmatched: ${unmatched_total:.2f}")

if __name__ == '__main__':
    print("Bet status updater started (60s interval)")
    while True:
        try:
            update_bet_status()
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(60)
