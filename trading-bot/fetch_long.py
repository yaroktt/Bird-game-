import time, requests, pandas as pd, sys
def get(bar="1H", days=730, inst="BTC-USDT"):
    now = int(time.time()*1000); start = now - days*86400000
    rows, after = [], now
    while after > start:
        for _ in range(5):
            try:
                r = requests.get("https://www.okx.com/api/v5/market/history-candles",
                    params=dict(instId=inst, bar=bar, after=after, limit=100), timeout=20).json()["data"]; break
            except Exception: time.sleep(1); r = None
        if not r: break
        rows += r; after = int(r[-1][0]); time.sleep(0.12)
    df = pd.DataFrame(rows).iloc[:, :6]; df.columns = ["ts","open","high","low","close","volume"]
    df["ts"] = pd.to_datetime(df.ts.astype("int64"), unit="ms")
    return df.set_index("ts").astype(float).sort_index().loc[lambda d: ~d.index.duplicated()]
if __name__ == "__main__":
    df = get(); df.to_csv("btc_1h_2y.csv"); print(len(df), df.index[0], df.index[-1], df.close.iloc[0], df.close.iloc[-1])
