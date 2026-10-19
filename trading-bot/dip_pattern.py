"""Mean-reversion 'dip bounce' pattern found in the 30-day BTC study.
Buy when price is stretched >Z_ENTRY std below its 12h mean AND RSI is oversold.
Exit when price returns to the mean, on a time stop, or on an ATR stop."""
import numpy as np, pandas as pd
from strategy import atr

P = dict(z_entry=-2.0, rsi_max=30, z_exit=0.0, max_bars=16, stop_atr=3.0, win=48)

def rsi(c, n=14):
    d = c.diff(); up = d.clip(lower=0).rolling(n).mean(); dn = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + up / dn)

def features(df, p=P):
    c = df.close
    z = (c - c.rolling(p["win"]).mean()) / c.rolling(p["win"]).std()
    return pd.DataFrame({"z": z, "rsi": rsi(c), "atr": atr(df, 14)})

def simulate(df, p=P, fee=0.001, cash0=10_000.0, frac=0.25):
    """Signal on closed candle i-1, fill at open of i. Returns (equity, trades DataFrame)."""
    f = features(df, p); o, h, l, c = (df[k].values for k in ("open", "high", "low", "close"))
    cash, qty, trades, eq = cash0, 0.0, [], np.empty(len(df))
    for i in range(len(df)):
        if qty > 0:
            bars = i - ent_i; ex_px = None; why = None
            if l[i] <= stop: ex_px, why = min(stop, o[i]), "stop"
            elif f.z.iloc[i-1] >= p["z_exit"]: ex_px, why = o[i], "mean"
            elif bars >= p["max_bars"]: ex_px, why = o[i], "time"
            if ex_px:
                cash += qty * ex_px * (1 - fee)
                trades.append(dict(entry=df.index[ent_i], exit=df.index[i], ret=(ex_px/ent_px-1)-2*fee, why=why, bars=bars))
                qty = 0.0
        elif i > 0 and f.z.iloc[i-1] <= p["z_entry"] and f.rsi.iloc[i-1] <= p["rsi_max"] and not np.isnan(f.atr.iloc[i-1]):
            size = min(cash * frac, cash); qty = size * (1 - fee) / o[i]; cash -= size
            ent_i, ent_px = i, o[i]; stop = o[i] - p["stop_atr"] * f.atr.iloc[i-1]
        eq[i] = cash + qty * c[i]
    return pd.Series(eq, index=df.index), pd.DataFrame(trades)

def report(name, df, fee):
    eq, t = simulate(df, fee=fee)
    bh = df.close.iloc[-1] / df.close.iloc[0] - 1
    if t.empty: print(f"{name}: no trades"); return eq, t
    print(f"{name} fee={fee*100:.2f}%/side: trades={len(t)} win%={100*(t.ret>0).mean():.0f} avg trade={t.ret.mean()*100:+.2f}% "
          f"| account ret={(eq.iloc[-1]/eq.iloc[0]-1)*100:+.2f}% maxDD={((eq/eq.cummax()-1).min())*100:.2f}% | buy&hold={bh*100:+.2f}%")
    return eq, t

if __name__ == "__main__":
    df = pd.read_csv("btc_15m_30d.csv", parse_dates=["ts"], index_col="ts")
    cut = df.index[0] + pd.Timedelta(days=20)
    for fee in (0.001, 0.0005, 0.0002):
        report("discovery 20d", df[:cut], fee); report("PAPER   10d  ", df[cut:], fee); print()
    _, t = simulate(df[cut:]); print(t.groupby("why").ret.agg(["count", "mean"]).round(4))
