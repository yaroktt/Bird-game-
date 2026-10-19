"""Strategy lab: 2 years of hourly BTC. Every strategy is a position series in {-1,0,1} (x leverage).
Signal at close of bar i-1 -> position held during bar i. Fee charged on turnover. Liquidation modelled
(leveraged position wiped if the bar's adverse move exceeds 1/lev)."""
import numpy as np, pandas as pd
from strategy import atr
from dip_pattern import rsi

df = pd.read_csv("btc_1h_2y.csv", parse_dates=["ts"], index_col="ts")
c, h, l, o = df.close, df.high, df.low, df.open
FEE = 0.001
ret = c.pct_change().fillna(0)

def run(pos, lev=1.0, fee=FEE):
    pos = pos.shift(1).fillna(0) * lev           # decided on prior close
    adverse = np.where(pos > 0, l / c.shift(1) - 1, np.where(pos < 0, -(h / c.shift(1) - 1), 0))
    liq = (pos != 0) & (adverse <= -0.9 / lev) if lev > 1 else pd.Series(False, index=c.index)
    r = pos * ret
    r = r.where(~liq, -1.0)                       # liquidated: lose whole stake
    turn = pos.diff().abs().fillna(0)
    r = r - turn * fee
    eq = (1 + r.clip(lower=-1)).cumprod()
    return eq, r, int(liq.sum())

def stats(eq, r):
    ann = np.sqrt(24 * 365)
    sh = r.mean() / r.std() * ann if r.std() > 0 else 0
    return dict(ret=(eq.iloc[-1] / eq.iloc[0] - 1) * 100, dd=(eq / eq.cummax() - 1).min() * 100, sharpe=sh)

def hold_state(entry, exit_):
    """stateful long: enter on entry, stay until exit_ true."""
    out, cur = np.zeros(len(entry)), 0
    e, x = entry.values, exit_.values
    for i in range(len(e)):
        cur = 0 if (cur and x[i]) else (1 if (not cur and e[i]) else cur)
        out[i] = cur
    return pd.Series(out, index=entry.index)

S = {}
# 1. dip bounce (the 30-day pattern), hourly
z = (c - c.rolling(48).mean()) / c.rolling(48).std()
S["dip bounce (long)"] = (hold_state((z < -2) & (rsi(c) < 30), z >= 0), 1)
# 2. Donchian breakout long/short
for n in (20, 55):
    up, dn = h.rolling(n).max().shift(1), l.rolling(n).min().shift(1)
    p = pd.Series(np.nan, index=c.index); p[c > up] = 1; p[c < dn] = -1
    S[f"Donchian {n}h breakout L/S"] = (p.ffill().fillna(0), 1)
# 3. EMA trend
p = (c.ewm(span=50).mean() > c.ewm(span=200).mean()).astype(int) * 2 - 1
S["EMA50/200 trend L/S"] = (p, 1)
S["EMA50/200 trend 3x lev"] = (p, 3)
# 4. volatility squeeze breakout
bw = (c.rolling(20).std() * 4) / c.rolling(20).mean()
sq = bw < bw.rolling(500).quantile(0.15)
p = pd.Series(np.nan, index=c.index)
brk_up = sq.shift(1) & (c > h.rolling(20).max().shift(1)); brk_dn = sq.shift(1) & (c < l.rolling(20).min().shift(1))
p[brk_up] = 1; p[brk_dn] = -1; p[(c < c.rolling(20).mean()) & (p.ffill() == 1)] = 0; p[(c > c.rolling(20).mean()) & (p.ffill() == -1)] = 0
S["Vol-squeeze breakout L/S"] = (p.ffill().fillna(0), 1)
# 5. capitulation bounce: huge red candle (range > 3 ATR, close in bottom), hold 12h
big = ((h - l) > 3 * atr(df, 24).shift(1)) & (c < o)
S["Capitulation bounce 12h"] = (big.rolling(12).max().fillna(0), 1)
# 6. spike fade: after >2% 4h pump, short for 6h
pump = c.pct_change(4) > 0.02
S["Fade 4h pumps (short 6h)"] = (-pump.rolling(6).max().fillna(0), 1)
# 7. 3x momentum: 24h return sign
S["24h momentum L/S 3x"] = (np.sign(c.pct_change(24)).fillna(0), 3)
# 8. hour-of-day seasonal (fit on first year, trade on all)
first = ret[: len(ret) // 2]; hr = first.groupby(first.index.hour).mean()
best = hr.sort_values().index[-4:]; worst = hr.sort_values().index[:4]
S["Hour-of-day seasonal (fit yr1)"] = (pd.Series(np.where(c.index.hour.isin(best), 1, np.where(c.index.hour.isin(worst), -1, 0)), index=c.index), 1)
# 9. slow daily-timeframe trend (low turnover)
d = c.resample("1D").last().dropna()
def up_daily(sig): return sig.reindex(c.index, method="ffill").shift(24).fillna(0)  # known only after day closes
S["Daily SMA100 long/flat"] = (up_daily((d > d.rolling(100).mean()).astype(int)), 1)
S["Daily SMA100 long/short"] = (up_daily((d > d.rolling(100).mean()).astype(int) * 2 - 1), 1)
S["Daily 20/100 EMA long/flat"] = (up_daily((d.ewm(span=20).mean() > d.ewm(span=100).mean()).astype(int)), 1)
S["Daily SMA100 long/flat 2x"] = (up_daily((d > d.rolling(100).mean()).astype(int)), 2)
# 10. buy&hold, for reference
S["BUY & HOLD"] = (pd.Series(1, index=c.index), 1)

def report(fee):
    mid = c.index[len(c) // 2]
    print(f"\n=== fee {fee*100:.2f}% per side ===")
    print(f"{'strategy':34s}{'YR1':>9s}{'YR2':>9s}{'2y ret':>9s}{'maxDD':>8s}{'sharpe':>8s}{'rt/yr':>7s}")
    for name, (pos, lev) in S.items():
        eq, r, liq = run(pos, lev, fee)
        e1, e2 = eq[eq.index < mid], eq[eq.index >= mid]
        st = stats(eq, r); rt = (pos.diff().abs().fillna(0).sum()) / 2 / 2
        print(f"{name:34s}{(e1.iloc[-1]/e1.iloc[0]-1)*100:8.1f}%{(e2.iloc[-1]/e2.iloc[0]-1)*100:8.1f}%{st['ret']:8.1f}%{st['dd']:7.1f}%{st['sharpe']:8.2f}{rt:7.0f}")

if __name__ == "__main__":
    print("BTC", c.index[0].date(), "->", c.index[-1].date(), f"{c.iloc[0]:.0f} -> {c.iloc[-1]:.0f}")
    for f in (0.0, 0.0002, 0.001): report(f)
