"""Live paper trader for the dip-bounce pattern. Uses PUBLIC OKX prices, no keys, no real orders.
State in paper_state.json, trades in paper_trades.csv. Run:  python paper_trade.py"""
import json, os, time, csv, requests, pandas as pd
import dip_pattern as D
P = dict(D.P, z_entry=-2.5, rsi_max=30, z_exit=-0.5, stop_atr=5.0, max_bars=16)
FEE, FRAC, STATE = 0.001, 0.25, "paper_state.json"

def candles(n=120):
    r = requests.get("https://www.okx.com/api/v5/market/candles",
                     params=dict(instId="BTC-USDT", bar="15m", limit=n), timeout=20).json()["data"]
    df = pd.DataFrame(r).iloc[:, :6]; df.columns = ["ts", "open", "high", "low", "close", "volume"]
    df["ts"] = pd.to_datetime(df.ts.astype("int64"), unit="ms")
    return df.set_index("ts").astype(float).sort_index().iloc[:-1]  # closed candles only

def step(s):
    df = candles(); last = df.index[-1]
    if s.get("last") == str(last): return s
    s["last"] = str(last); f = D.features(df, P); z, rsi, atr, px = f.z.iloc[-1], f.rsi.iloc[-1], f.atr.iloc[-1], df.close.iloc[-1]
    pos = s.get("pos")
    if pos:
        pos["bars"] += 1; why = "stop" if px <= pos["stop"] else "mean" if z >= P["z_exit"] else "time" if pos["bars"] >= P["max_bars"] else None
        if why:
            s["cash"] += pos["qty"] * px * (1 - FEE)
            new = not os.path.exists("paper_trades.csv")
            with open("paper_trades.csv", "a", newline="") as fh:
                w = csv.writer(fh); new and w.writerow(["time", "entry", "exit", "ret", "why"])
                w.writerow([last, pos["px"], px, round(px / pos["px"] - 1 - 2 * FEE, 5), why])
            print(f"{last} EXIT {why} @ {px:.1f}"); s["pos"] = None
    elif z <= P["z_entry"] and rsi <= P["rsi_max"]:
        size = s["cash"] * FRAC; s["cash"] -= size
        s["pos"] = dict(qty=size * (1 - FEE) / px, px=px, stop=px - P["stop_atr"] * atr, bars=0)
        print(f"{last} ENTER @ {px:.1f} z={z:.2f} rsi={rsi:.0f}")
    eq = s["cash"] + (s["pos"]["qty"] * px if s["pos"] else 0)
    print(f"{last} px={px:.1f} z={z:.2f} rsi={rsi:.0f} equity={eq:.2f}"); return s

if __name__ == "__main__":
    s = json.load(open(STATE)) if os.path.exists(STATE) else dict(cash=10_000.0, pos=None)
    while True:
        try: s = step(s); json.dump(s, open(STATE, "w"))
        except Exception as e: print("error, retrying:", e)
        time.sleep(60)
