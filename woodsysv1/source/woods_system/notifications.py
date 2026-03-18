"""
Woods System — Notifications (Telegram + Email)

Sends overlay reports, bet confirmations, and performance summaries
directly to your phone via Telegram, and full daily reports via email.

Alan had a room full of screens. You get a ping on your phone.
"""

import os
import json
import smtplib
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime


class TelegramBot:
    """
    Sends messages to your Telegram chat.

    Setup (one-time, 2 minutes):
    1. Open Telegram, search for @BotFather
    2. Send /newbot, follow prompts, copy your bot token
    3. Send any message to your new bot
    4. Visit: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
    5. Copy the chat_id from the response
    6. Set both in config.py or environment variables
    """

    BASE_URL = "https://api.telegram.org/bot{token}"

    def __init__(self, token: str = None, chat_id: str = None):
        self.token = token or os.environ.get("TELEGRAM_BOT_TOKEN", "")
        self.chat_id = chat_id or os.environ.get("TELEGRAM_CHAT_ID", "")
        self.enabled = bool(self.token and self.chat_id)

        if not self.enabled:
            print("  [Telegram] Not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.")

    def send(self, message: str, parse_mode: str = "HTML") -> bool:
        """Send a message to the configured chat."""
        if not self.enabled:
            return False

        try:
            url = f"{self.BASE_URL.format(token=self.token)}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": message,
                "parse_mode": parse_mode,
                "disable_web_page_preview": True,
            }
            resp = requests.post(url, json=payload, timeout=10)
            resp.raise_for_status()
            return True
        except Exception as e:
            print(f"  [Telegram] Error: {e}")
            return False

    def send_overlay_alert(self, overlay: dict) -> bool:
        """Send an alert for a single overlay found."""
        tier_emoji = {"STRONG": "🔥", "MODERATE": "⚡", "MARGINAL": "📊"}
        emoji = tier_emoji.get(overlay["tier"], "📊")

        stat = overlay["market"].replace("player_", "").upper()
        msg = (
            f"{emoji} <b>OVERLAY FOUND</b> [{overlay['tier']}]\n\n"
            f"<b>{overlay['player']}</b>\n"
            f"{stat} {overlay['side']} {overlay['line']} @ {overlay['odds_american']:+d}\n\n"
            f"Model: {overlay['model_prob']:.1%}  |  Market: {overlay['market_implied']:.1%}\n"
            f"Edge: {overlay['edge']:.1%}  |  WinExp: {overlay['win_expectation']:.3f}\n"
        )
        return self.send(msg)

    def send_bet_card(self, bets: list[dict], bankroll: float) -> bool:
        """Send the full bet card."""
        if not bets:
            return self.send("📭 <b>No bets today.</b> Discipline is the edge.")

        msg = f"🎯 <b>BET CARD</b> — {datetime.now().strftime('%b %d, %Y')}\n"
        msg += f"Bankroll: ${bankroll:,.0f}\n"
        msg += "─" * 30 + "\n\n"

        total_risk = 0
        for i, bet in enumerate(bets, 1):
            stat = bet["market"].replace("player_", "").upper()
            msg += (
                f"<b>#{i} {bet['player']}</b>\n"
                f"  {stat} {bet['side']} {bet['line']} @ {bet['odds_american']:+d}\n"
                f"  Stake: ${bet['bet_size']:,.0f} | Edge: {bet['edge']:.1%}\n\n"
            )
            total_risk += bet["bet_size"]

        msg += f"─" * 30 + "\n"
        msg += f"Total risk: ${total_risk:,.0f} ({total_risk/bankroll:.1%} of bankroll)"

        return self.send(msg)

    def send_bet_placed(self, bet: dict, exchange_ref: str = None) -> bool:
        """Confirm a bet was auto-placed."""
        stat = bet["market"].replace("player_", "").upper()
        msg = (
            f"✅ <b>BET PLACED</b>\n\n"
            f"{bet['player']} {stat} {bet['side']} {bet['line']}\n"
            f"Stake: ${bet['bet_size']:,.0f} @ {bet['odds_american']:+d}\n"
            f"Edge: {bet['edge']:.1%}"
        )
        if exchange_ref:
            msg += f"\nRef: {exchange_ref}"
        return self.send(msg)

    def send_result(self, result: dict) -> bool:
        """Send a bet result notification."""
        emoji = "💰" if result["result"] == "WIN" else "❌"
        msg = (
            f"{emoji} <b>{result['result']}</b>: {result.get('player', 'Unknown')}\n"
            f"P&L: ${result['pnl']:+,.2f}\n"
            f"Bankroll: ${result['running_bankroll']:,.2f}"
        )
        return self.send(msg)

    def send_daily_summary(self, report: str) -> bool:
        """Send the daily performance summary."""
        # Telegram has a 4096 char limit, truncate if needed
        if len(report) > 4000:
            report = report[:3990] + "\n..."
        return self.send(f"<pre>{report}</pre>")


class EmailNotifier:
    """
    Sends daily reports via email using SMTP.
    Works with Gmail, Outlook, or any SMTP provider.

    For Gmail:
    1. Enable 2FA on your Google account
    2. Generate an App Password at https://myaccount.google.com/apppasswords
    3. Use that as SMTP_PASSWORD (not your regular password)
    """

    def __init__(
        self,
        smtp_host: str = None,
        smtp_port: int = None,
        smtp_user: str = None,
        smtp_password: str = None,
        recipient: str = None,
    ):
        self.smtp_host = smtp_host or os.environ.get("SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = smtp_port or int(os.environ.get("SMTP_PORT", "587"))
        self.smtp_user = smtp_user or os.environ.get("SMTP_USER", "")
        self.smtp_password = smtp_password or os.environ.get("SMTP_PASSWORD", "")
        self.recipient = recipient or os.environ.get("NOTIFY_EMAIL", "")
        self.enabled = bool(self.smtp_user and self.smtp_password and self.recipient)

        if not self.enabled:
            print("  [Email] Not configured. Set SMTP_USER, SMTP_PASSWORD, NOTIFY_EMAIL.")

    def send(self, subject: str, body: str, html: bool = False) -> bool:
        """Send an email."""
        if not self.enabled:
            return False

        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = self.smtp_user
            msg["To"] = self.recipient

            content_type = "html" if html else "plain"
            msg.attach(MIMEText(body, content_type))

            with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
                server.starttls()
                server.login(self.smtp_user, self.smtp_password)
                server.sendmail(self.smtp_user, self.recipient, msg.as_string())

            return True
        except Exception as e:
            print(f"  [Email] Error: {e}")
            return False

    def send_daily_report(self, report: str, bet_card: str) -> bool:
        """Send the full daily report with bet card."""
        today = datetime.now().strftime("%b %d, %Y")
        subject = f"Woods System — Daily Report — {today}"

        body = f"""
        <html>
        <body style="font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px;">
        <h2 style="color: #e94560;">🏀 Woods System — {today}</h2>
        <pre style="background: #16213e; padding: 15px; border-radius: 8px; overflow-x: auto;">
{report}
        </pre>
        <h3 style="color: #e94560;">Bet Card</h3>
        <pre style="background: #16213e; padding: 15px; border-radius: 8px; overflow-x: auto;">
{bet_card}
        </pre>
        <p style="color: #666; font-size: 12px;">
        "After each race, the computer got smarter." — Alan Woods
        </p>
        </body>
        </html>
        """
        return self.send(subject, body, html=True)


class NotificationManager:
    """Unified notification interface — sends to all configured channels."""

    def __init__(self):
        self.telegram = TelegramBot()
        self.email = EmailNotifier()

    def notify_overlays(self, overlays: list[dict]):
        """Notify about overlays found."""
        for overlay in overlays:
            self.telegram.send_overlay_alert(overlay)

    def notify_bet_card(self, bets: list[dict], bankroll: float):
        """Send the bet card."""
        self.telegram.send_bet_card(bets, bankroll)

    def notify_bet_placed(self, bet: dict, exchange_ref: str = None):
        """Confirm auto-placed bet."""
        self.telegram.send_bet_placed(bet, exchange_ref)

    def notify_result(self, result: dict):
        """Notify about a bet result."""
        self.telegram.send_result(result)

    def notify_daily_report(self, overlay_report: str, bet_card_report: str):
        """Send end-of-day reports."""
        self.telegram.send_daily_summary(overlay_report)
        self.email.send_daily_report(overlay_report, bet_card_report)

    def notify_error(self, error_msg: str):
        """Alert on system errors."""
        self.telegram.send(f"⚠️ <b>SYSTEM ERROR</b>\n\n{error_msg}")


if __name__ == "__main__":
    print("=== Notification Test ===")
    print("Telegram configured:", TelegramBot().enabled)
    print("Email configured:", EmailNotifier().enabled)
