import numpy as np
import pandas as pd


def atr(df, period):
    pc = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(),
                    (df["low"] - pc).abs()], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def signals(df, p):
    """+1 where short MA is above long MA, else 0 (long-only)."""
    s = df["close"].rolling(int(p["short_ma"])).mean()
    l = df["close"].rolling(int(p["long_ma"])).mean()
    return (s > l).astype(int)
