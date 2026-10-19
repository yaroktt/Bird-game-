"""5-minute live paper trade with EUR 100. Real OKX BTC-EUR prices, 0.1% fee/side, 2s polling.
Rule (fixed in advance): buy when price is >0.04% below its 40s average; sell at the average,
+0.25% take-profit, -0.25% stop, or 90s time stop. One position at a time. Force-close at 5:00."""
import time, requests, statistics as st
FEE, CASH0, DUR = 0.001, 100.0, 300
cash, qty, ent, t_ent, log, hist = CASH0, 0.0, 0.0, 0, [], []
def px():
    return float(requests.get("https://www.okx.com/api/v5/market/ticker", params=dict(instId="BTC-EUR"), timeout=5).json()["data"][0]["last"])
t0 = time.time(); first = None
while time.time() - t0 < DUR:
    try: p = px()
    except Exception: time.sleep(1); continue
    now = time.time() - t0; first = first or p; hist.append((now, p))
    avg = st.mean(x for t, x in hist if now - t <= 40)
    if qty:
        r = p / ent - 1
        why = "target" if r >= .0025 else "stop" if r <= -.0025 else "mean" if p >= avg else "time" if now - t_ent >= 90 else None
        if why:
            cash = qty * p * (1 - FEE); log.append((why, r - 2 * FEE)); print(f"{now:5.0f}s SELL {why} @ {p:.2f}  cash={cash:.2f}", flush=True); qty = 0
    elif now > 40 and p < avg * (1 - .0004) and DUR - now > 60:
        qty = cash * (1 - FEE) / p; cash = 0; ent, t_ent = p, now; print(f"{now:5.0f}s BUY  @ {p:.2f} (avg {avg:.2f})", flush=True)
    time.sleep(2)
p = hist[-1][1]
if qty: cash = qty * p * (1 - FEE); log.append(("close", p / ent - 1 - 2 * FEE)); print(f"300s force-close @ {p:.2f}")
print(f"\nFINAL: EUR {cash:.2f} ({cash - CASH0:+.2f}, {(cash/CASH0-1)*100:+.2f}%) | trades={len(log)} | buy&hold would be {(p/first-1)*100:+.2f}% before fees (BTC {first:.2f} -> {p:.2f})")
