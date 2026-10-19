"""Live loop. DEMO by default. Uses params.json from optimize.py.
Run:  python bot.py            (OKX demo trading)
      python bot.py --live     (real money; don't until demo runs clean for weeks)"""
import json
import logging
import os
import sys
import time
import ccxt
import pandas as pd
from dotenv import load_dotenv
import config as C
from strategy import atr, signals

load_dotenv()
logging.basicConfig(level=logging.INFO, filename="bot.log",
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger()
log.addHandler(logging.StreamHandler())


def make_exchange(live):
    ex = ccxt.okx({"apiKey": os.environ["OKX_API_KEY"], "secret": os.environ["OKX_API_SECRET"],
                   "password": os.environ["OKX_API_PASSPHRASE"], "enableRateLimit": True})
    if not live:
        ex.set_sandbox_mode(True)  # OKX demo trading
    return ex


def candles(ex, n=300):
    rows = ex.fetch_ohlcv(C.SYMBOL, C.TIMEFRAME, limit=n)
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms")
    return df.set_index("ts").iloc[:-1]  # drop the unfinished candle


def equity(ex):
    bal = ex.fetch_balance()
    base = C.SYMBOL.split("/")[0]
    px = ex.fetch_ticker(C.SYMBOL)["last"]
    return bal["total"].get("USDT", 0) + bal["total"].get(base, 0) * px, bal["total"].get(base, 0), px


def main(live):
    p = json.load(open("params.json"))
    ex = make_exchange(live)
    eq0, _, _ = equity(ex)
    day, day_start, halted = pd.Timestamp.utcnow().date(), eq0, False
    stop = tp = None
    log.info("Started (%s) params=%s equity=%.2f", "LIVE" if live else "DEMO", p, eq0)
    while True:
        try:
            if pd.Timestamp.utcnow().date() != day:
                day, (day_start, _, _), halted = pd.Timestamp.utcnow().date(), (equity(ex)), False
            eq, held, px = equity(ex)
            in_pos = held * px > 10
            if not halted and eq < day_start * (1 - C.DAILY_LOSS_LIMIT):
                halted = True
                log.warning("Daily loss limit hit: shutting off until tomorrow")
                if in_pos:
                    ex.create_market_sell_order(C.SYMBOL, held)
                    in_pos = False
            df = candles(ex)
            sig = signals(df, p)
            a = atr(df, int(p["atr_period"])).iloc[-1]
            if in_pos:
                if px <= stop or px >= tp or sig.iloc[-1] == 0:
                    ex.create_market_sell_order(C.SYMBOL, held)
                    log.info("SELL %.6f @ %.2f", held, px)
            elif not halted and sig.iloc[-1] == 1 and sig.iloc[-2] == 0:
                usdt = min(eq * C.MAX_POSITION_FRACTION, ex.fetch_balance()["free"]["USDT"])
                amt = float(ex.amount_to_precision(C.SYMBOL, usdt / px))
                ex.create_market_buy_order(C.SYMBOL, amt)
                stop, tp = px - p["atr_stop_mult"] * a, px + p["take_profit_atr_mult"] * a
                log.info("BUY %.6f @ %.2f stop=%.2f tp=%.2f", amt, px, stop, tp)
        except (ccxt.NetworkError, ccxt.ExchangeNotAvailable) as e:
            log.error("network error, retrying: %s", e)
        except Exception:
            log.exception("unexpected error")
        time.sleep(30)


if __name__ == "__main__":
    main("--live" in sys.argv)
