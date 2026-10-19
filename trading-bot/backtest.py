import numpy as np
import pandas as pd
import config as C
from strategy import atr, signals


def run(df, p, fee=C.FEE, cash0=C.STARTING_CASH):
    """Long-only MA-cross with ATR stop / take-profit. Returns (equity Series, n_trades).
    Entry on the NEXT candle's open after a cross (no lookahead). Stop/TP checked intra-candle,
    stop first if both hit (conservative). Daily loss limit halts trading for the day."""
    if p["short_ma"] >= p["long_ma"]:
        return pd.Series([cash0], index=df.index[:1]), 0
    sig = signals(df, p).values
    a = atr(df, int(p["atr_period"])).values
    o, h, l, c = (df[k].values for k in ("open", "high", "low", "close"))
    days = df.index.normalize().values
    cash, qty, entry, stop, tp, trades = cash0, 0.0, 0.0, 0.0, 0.0, 0
    day_start_eq, cur_day, halted = cash0, days[0], False
    eq = np.empty(len(df))
    for i in range(len(df)):
        if days[i] != cur_day:
            cur_day, day_start_eq, halted = days[i], cash + qty * o[i], False
        if qty > 0:
            exit_px = None
            if l[i] <= stop:
                exit_px = min(stop, o[i])
            elif h[i] >= tp:
                exit_px = max(tp, o[i])
            elif sig[i - 1] == 0:
                exit_px = o[i]
            if exit_px is not None:
                cash += qty * exit_px * (1 - fee)
                qty, trades = 0.0, trades + 1
        elif i > 0 and sig[i - 1] == 1 and (i < 2 or sig[i - 2] == 0) \
                and not halted and not np.isnan(a[i - 1]):
            equity = cash
            size = min(equity * C.MAX_POSITION_FRACTION, cash)
            qty = size * (1 - fee) / o[i]
            cash -= size
            entry = o[i]
            stop = entry - p["atr_stop_mult"] * a[i - 1]
            tp = entry + p["take_profit_atr_mult"] * a[i - 1]
        eq[i] = cash + qty * c[i]
        if not halted and eq[i] < day_start_eq * (1 - C.DAILY_LOSS_LIMIT):
            halted = True
            if qty > 0:
                cash += qty * c[i] * (1 - fee)
                qty, trades = 0.0, trades + 1
                eq[i] = cash
    return pd.Series(eq, index=df.index), trades


def metrics(eq, timeframe_min=5):
    r = eq.pct_change().dropna()
    if len(r) < 2 or r.std() == 0:
        return dict(sharpe=0.0, max_dd=0.0, ret=0.0)
    per_year = 365 * 24 * 60 / timeframe_min
    sharpe = r.mean() / r.std() * np.sqrt(per_year)
    dd = (eq / eq.cummax() - 1).min()
    return dict(sharpe=float(sharpe), max_dd=float(-dd), ret=float(eq.iloc[-1] / eq.iloc[0] - 1))
