# Strategy test results (BTC/USDT, OKX data, fees included)

Run `python fetch_long.py && python lab.py` (2y hourly) to reproduce.

- 2y hourly (Oct 2024 - Oct 2026): every active strategy tried lost money at 0.1%/side fees:
  dip bounce, Donchian breakout (20h/55h), EMA50/200 L/S, volatility squeeze, capitulation bounce,
  pump fade, hour-of-day seasonal, 3x leveraged momentum/trend (-96% to -100%).
  Even at ZERO fees most were negative; only capitulation bounce (+12%) and daily trend were positive.
- Only daily trend following (long when price/EMA above its slow average, else cash) survived:
  tested on 9 years of daily data (2017-2026), it cut max drawdown from -83% to about -45..-50%
  and held up across EMA/SMA parameter choices. It does not beat buy & hold in strong bull years
  and was flat from 2025 on. It trades ~2-6 times a year, so fees barely matter.
- Leverage did not rescue anything: constant 3x leverage on losing signals just loses faster.
