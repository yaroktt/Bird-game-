# Trading bot (starter)

MA-cross strategy with ATR stops, Optuna tuning and walk-forward validation, for OKX.

```
pip install -r requirements.txt
python optimize.py --synthetic   # offline pipeline test on fake data
python optimize.py               # real OKX history -> params.json
cp .env.example .env             # add DEMO keys (trade-only, no withdrawal)
python bot.py                    # OKX demo trading
```

Fixed limits live in `config.py` (position size, daily loss cap) and are never touched by the optimizer.
Re-tune weekly by re-running `optimize.py`; `clamp_change` limits how far settings can move.
Most strategies lose after fees. Trust only out-of-sample results, demo for weeks first.
