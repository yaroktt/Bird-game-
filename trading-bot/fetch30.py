import time, requests, pandas as pd
def get(bar="15m", days=30):
    end_ms = int(time.time()*1000); start = end_ms - days*86400000
    rows, after = [], end_ms
    while after > start:
        r = requests.get("https://www.okx.com/api/v5/market/history-candles",
            params=dict(instId="BTC-USDT", bar=bar, after=after, limit=100), timeout=20).json()["data"]
        if not r: break
        rows += r; after = int(r[-1][0]); time.sleep(0.15)
    df = pd.DataFrame(rows).iloc[:, :6]; df.columns = ["ts","open","high","low","close","volume"]
    df["ts"] = pd.to_datetime(df.ts.astype("int64"), unit="ms")
    df = df.set_index("ts").astype(float).sort_index()
    return df[~df.index.duplicated()].loc[pd.Timestamp.utcnow().tz_localize(None)-pd.Timedelta(days=days):]
if __name__ == "__main__":
    df = get(); df.to_csv("btc_15m_30d.csv"); print(len(df), df.index[0], df.index[-1], df.close.iloc[0], df.close.iloc[-1])
