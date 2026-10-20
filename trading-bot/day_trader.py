"""Paper-trade EUR 100 across several coins until midnight Europe/Berlin. REAL OKX prices, NO real orders.
Rule (fixed up front): dip-bounce on 5m candles. Buy a coin when its price is >2.5 std below its 4h mean AND RSI<28.
Exit at the mean (z>=-0.3), +1.5% take-profit, -1.5% stop, or 3h time stop.
Costs: 0.1% fee/side + 0.05% slippage. Limits (fixed): max 2 positions, 50% of equity each,
trading stops for the day if equity falls 5% below the start."""
import csv, json, os, sys, time, requests, numpy as np, pandas as pd
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
COINS = ["BTC", "ETH", "SOL", "ZEC", "BNB", "TAO", "HYPE", "AAVE", "LTC"]
FEE, SLIP, FRAC, MAXPOS, LOSS_CAP = 0.001, 0.0005, 0.5, 2, 0.05
Z_IN, RSI_IN, Z_OUT, TP, SL, MAX_MIN, WIN = -2.5, 28, -0.3, 0.015, 0.015, 180, 48
TZ = ZoneInfo("Europe/Berlin"); STATE = "day_state.json"; TRADES = "day_trades.csv"
END = (datetime.now(TZ) + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

def candles(coin):
    r = requests.get("https://www.okx.com/api/v5/market/candles", params=dict(instId=f"{coin}-EUR", bar="5m", limit=100), timeout=15).json()["data"]
    df = pd.DataFrame(r).iloc[:, :6]; df.columns = ["ts", "o", "h", "l", "c", "v"]
    return df.astype({"c": float, "ts": "int64"}).sort_values("ts").iloc[:-1].reset_index(drop=True)  # closed bars only

def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).rolling(n).mean(); dn = (-d.clip(upper=0)).rolling(n).mean(); return 100 - 100 / (1 + up / dn)

def last_px(coin):
    return float(requests.get("https://www.okx.com/api/v5/market/ticker", params=dict(instId=f"{coin}-EUR"), timeout=10).json()["data"][0]["last"])

def log(m): print(f"{datetime.now(TZ):%H:%M:%S} {m}", flush=True)

s = json.load(open(STATE)) if os.path.exists(STATE) else dict(cash=100.0, pos={}, start=100.0, halted=False)
def save(): json.dump(s, open(STATE, "w"))
def equity(px): return s["cash"] + sum(p["qty"] * px.get(c, p["entry"]) for c, p in s["pos"].items())
def close(coin, price, why):
    p = s["pos"].pop(coin); fill = price * (1 - SLIP); s["cash"] += p["qty"] * fill * (1 - FEE)
    ret = fill / p["entry"] - 1 - 2 * FEE
    new = not os.path.exists(TRADES)
    with open(TRADES, "a", newline="") as fh:
        w = csv.writer(fh); new and w.writerow(["coin", "entry_time", "exit_time", "entry", "exit", "ret", "why"])
        w.writerow([coin, p["t"], datetime.now(TZ).isoformat(timespec="seconds"), p["entry"], round(fill, 4), round(ret, 5), why])
    log(f"SELL {coin} @ {fill:.4f} ({why}) trade {ret*100:+.2f}%  cash={s['cash']:.2f}")

log(f"Start: EUR {s['cash']:.2f}, trading until {END:%H:%M} Berlin"); last_bar = {}
while datetime.now(TZ) < END:
    px, feats = {}, {}
    for coin in COINS:
        try:
            df = candles(coin); c = df.c; z = (c - c.rolling(WIN).mean()) / c.rolling(WIN).std()
            px[coin] = last_px(coin); feats[coin] = (z.iloc[-1], rsi(c).iloc[-1], df.ts.iloc[-1])
        except Exception as e:
            log(f"data error {coin}: {str(e)[:60]}")
    for coin, p in list(s["pos"].items()):
        if coin not in px: continue
        r = px[coin] / p["entry"] - 1; age = (time.time() - p["ts"]) / 60
        why = "target" if r >= TP else "stop" if r <= -SL else "mean" if feats[coin][0] >= Z_OUT else "time" if age >= MAX_MIN else None
        if why: close(coin, px[coin], why)
    eq = equity(px)
    if not s["halted"] and eq < s["start"] * (1 - LOSS_CAP): s["halted"] = True; log("DAILY LOSS CAP hit: no new trades")
    if not s["halted"]:
        for coin, (z, r, ts) in sorted(feats.items(), key=lambda kv: kv[1][0]):
            if len(s["pos"]) >= MAXPOS: break
            if coin in s["pos"] or coin not in px or np.isnan(z): continue
            if z <= Z_IN and r <= RSI_IN and (END - datetime.now(TZ)).total_seconds() > 600:
                size = min(eq * FRAC, s["cash"]); fill = px[coin] * (1 + SLIP)
                s["cash"] -= size; s["pos"][coin] = dict(qty=size * (1 - FEE) / fill, entry=fill, t=datetime.now(TZ).isoformat(timespec="seconds"), ts=time.time())
                log(f"BUY  {coin} @ {fill:.4f} z={z:.2f} rsi={r:.0f} size={size:.2f}")
    save()
    if int(time.time()) % 900 < 35: log(f"heartbeat equity={equity(px):.2f} open={list(s['pos'])} " + " ".join(f"{c}:{feats[c][0]:+.1f}" for c in feats))
    time.sleep(30)
px = {}
for coin in list(s["pos"]):
    try: px[coin] = last_px(coin); close(coin, px[coin], "end-of-day")
    except Exception as e: log(f"close error {coin}: {e}")
save(); tr = pd.read_csv(TRADES) if os.path.exists(TRADES) else pd.DataFrame(columns=["ret"])
log(f"FINAL: EUR {s['cash']:.2f} ({s['cash']-s['start']:+.2f}, {(s['cash']/s['start']-1)*100:+.2f}%) | trades={len(tr)} wins={int((tr.ret>0).sum())}")
