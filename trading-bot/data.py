import os
import numpy as np
import pandas as pd

COLS = ["ts", "open", "high", "low", "close", "volume"]


def fetch_ohlcv(symbol, timeframe, days, cache="data_cache.csv"):
    """Download history from OKX (public data, no keys needed) with paging."""
    import ccxt
    if os.path.exists(cache):
        return pd.read_csv(cache, parse_dates=["ts"], index_col="ts")
    ex = ccxt.okx()
    ms = ex.parse_timeframe(timeframe) * 1000
    since = ex.milliseconds() - days * 86_400_000
    rows = []
    while since < ex.milliseconds():
        batch = ex.fetch_ohlcv(symbol, timeframe, since=since, limit=100)
        if not batch:
            break
        rows += batch
        since = batch[-1][0] + ms
    df = pd.DataFrame(rows, columns=COLS).drop_duplicates("ts")
    df["ts"] = pd.to_datetime(df["ts"], unit="ms")
    df = df.set_index("ts").sort_index()
    df.to_csv(cache)
    return df


def synthetic(days=365, timeframe_min=5, seed=1):
    """Random-walk candles for testing the pipeline offline. NOT real prices."""
    rng = np.random.default_rng(seed)
    n = days * 24 * 60 // timeframe_min
    ret = rng.normal(0, 0.0015, n)
    close = 30_000 * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[close[0]], close[:-1]])
    spread = np.abs(rng.normal(0, 0.001, n)) * close
    idx = pd.date_range("2025-01-01", periods=n, freq=f"{timeframe_min}min")
    return pd.DataFrame({"open": open_, "high": np.maximum(open_, close) + spread,
                         "low": np.minimum(open_, close) - spread, "close": close,
                         "volume": 1.0}, index=idx)
