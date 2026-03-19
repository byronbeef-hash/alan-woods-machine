"""
Woods System — 5-Minute Settlement & Scan Loop

Runs every 5 minutes to:
1. Check for finished NBA games and settle pending bets
2. Scan for new horse racing overlays
3. Update dashboard data

This should be deployed to Railway or run as a background process.
"""

import time
import schedule
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger('settlement')


def settle_pending_bets():
    """Check all pending bets and settle any where the game has finished."""
    try:
        from database import Database
        db = Database()
        
        pending = db.client.table('bets').select('*').eq('result', 'PENDING').execute()
        if not pending.data:
            log.info("No pending bets to settle")
            return
        
        log.info(f"Checking {len(pending.data)} pending bets...")
        
        # Get NBA scoreboard
        try:
            from nba_api.live.nba.endpoints import scoreboard, boxscore
            sb = scoreboard.ScoreBoard()
            games = sb.get_dict()['scoreboard']['games']
            
            # Build map of finished games
            finished_games = {}
            for g in games:
                status = g['gameStatusText']
                if 'Final' in status:
                    home = g['homeTeam']['teamName']
                    away = g['awayTeam']['teamName']
                    finished_games[home] = g['gameId']
                    finished_games[away] = g['gameId']
            
            if not finished_games:
                log.info("No finished games yet")
                return
            
            stat_map = {
                'player_points': 'points',
                'player_assists': 'assists', 
                'player_rebounds': 'reboundsTotal',
                'player_threes': 'threePointersMade',
                'player_steals': 'steals',
                'player_blocks': 'blocks',
                'player_turnovers': 'turnovers',
            }
            
            settled_count = 0
            for bet in pending.data:
                home_team = bet.get('home_team', '')
                # Extract team name (e.g. "Minnesota Timberwolves" from full name)
                team_short = home_team.split()[-1] if home_team else ''
                
                game_id = None
                for team_name, gid in finished_games.items():
                    if team_short.lower() in team_name.lower():
                        game_id = gid
                        break
                
                if not game_id:
                    continue
                
                # Get boxscore
                try:
                    bs = boxscore.BoxScore(game_id)
                    data = bs.get_dict()['game']
                except Exception:
                    continue
                
                player_name = bet['player']
                stat_key = stat_map.get(bet['market'])
                if not stat_key:
                    continue
                
                # Find player
                actual = None
                for team_key in ['homeTeam', 'awayTeam']:
                    for p in data[team_key]['players']:
                        if player_name.lower().replace('.', '').replace(' ', '') in p['name'].lower().replace('.', '').replace(' ', ''):
                            actual = int(p['statistics'].get(stat_key, 0))
                            break
                    if actual is not None:
                        break
                
                if actual is None:
                    continue
                
                # Determine result
                won = actual < bet['line'] if bet['side'] == 'Under' else actual > bet['line']
                result = 'WIN' if won else 'LOSS'
                odds_decimal = bet.get('odds_decimal', 1.91) or 1.91
                bet_size = bet.get('bet_size', 500) or 500
                pnl = bet_size * (odds_decimal - 1) if won else -bet_size
                
                log.info(f"  SETTLED: {player_name} {bet['side']} {bet['line']} | Actual: {actual} | {result} | ${pnl:+.0f}")
                
                db.client.table('bets').update({
                    'result': result,
                    'actual_stat': actual,
                    'pnl': round(pnl, 2),
                    'settled_at': datetime.now(timezone.utc).isoformat(),
                    'game_status': 'final',
                }).eq('id', bet['id']).execute()
                settled_count += 1
            
            if settled_count > 0:
                # Recalculate running bankroll
                all_bets = db.client.table('bets').select('*').order('created_at').execute()
                running = 5000
                for b in all_bets.data:
                    if b['result'] in ('WIN', 'LOSS'):
                        running += (b.get('pnl', 0) or 0)
                        db.client.table('bets').update({'running_bankroll': running}).eq('id', b['id']).execute()
                
                log.info(f"  Settled {settled_count} bets. Bankroll: ${running:,.0f}")
            else:
                log.info("  No bets ready to settle (games not finished or players not found)")
                
        except Exception as e:
            log.error(f"NBA settlement error: {e}")
            
    except Exception as e:
        log.error(f"Settlement error: {e}")


def run_loop():
    """Main loop — runs settlement every 5 minutes."""
    log.info("=" * 60)
    log.info("  Woods System — Settlement Loop")
    log.info("  Running every 5 minutes")
    log.info("=" * 60)
    
    # Run immediately on start
    settle_pending_bets()
    
    # Schedule every 5 minutes
    schedule.every(5).minutes.do(settle_pending_bets)
    
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    run_loop()
