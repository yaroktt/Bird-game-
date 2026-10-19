"""Optuna search + walk-forward validation."""
import json
import sys
import optuna
import pandas as pd
import config as C
from backtest import run, metrics

optuna.logging.set_verbosity(optuna.logging.WARNING)
TF_MIN = 5


def score(df, p):
    eq, n = run(df, p)
    if n < 5:
        return -10.0  # too few trades to trust
    m = metrics(eq, TF_MIN)
    return m["sharpe"] - C.MAX_DD_PENALTY * m["max_dd"]


def suggest(trial):
    R = C.RANGES
    return dict(
        short_ma=trial.suggest_int("short_ma", *R["short_ma"]),
        long_ma=trial.suggest_int("long_ma", *R["long_ma"]),
        atr_period=trial.suggest_int("atr_period", *R["atr_period"]),
        atr_stop_mult=trial.suggest_float("atr_stop_mult", *R["atr_stop_mult"]),
        take_profit_atr_mult=trial.suggest_float("take_profit_atr_mult", *R["take_profit_atr_mult"]),
    )


def optimize(df, n_trials=C.N_TRIALS, seed=0):
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(lambda t: score(df, suggest(t)), n_trials=n_trials)
    return study.best_params, study.best_value


def clamp_change(new, old, max_change=C.MAX_PARAM_CHANGE):
    """Limit how far any setting may move in one re-tune."""
    out = {}
    for k, v in new.items():
        if old and k in old:
            lo, hi = old[k] * (1 - max_change), old[k] * (1 + max_change)
            v = min(max(v, lo), hi)
            if isinstance(old[k], int):
                v = int(round(v))
        out[k] = v
    return out


def walk_forward(df, train_days=C.TRAIN_DAYS, test_days=C.TEST_DAYS, n_trials=C.N_TRIALS):
    start, end = df.index[0], df.index[-1]
    folds, t = [], start
    prev = None
    while t + pd.Timedelta(days=train_days + test_days) <= end:
        tr = df[t: t + pd.Timedelta(days=train_days)]
        te = df[t + pd.Timedelta(days=train_days): t + pd.Timedelta(days=train_days + test_days)]
        best, tr_score = optimize(tr, n_trials)
        best = clamp_change(best, prev)
        eq, n = run(te, best)
        m = metrics(eq, TF_MIN)
        folds.append(dict(start=str(t.date()), params=best, train_score=tr_score, trades=n, **m))
        print(f"fold {t.date()}: train={tr_score:.2f} | test ret={m['ret']:+.2%} "
              f"sharpe={m['sharpe']:.2f} dd={m['max_dd']:.2%} trades={n}")
        prev = best
        t += pd.Timedelta(days=test_days)
    return folds


if __name__ == "__main__":
    from data import fetch_ohlcv, synthetic
    use_synth = "--synthetic" in sys.argv
    df = synthetic() if use_synth else fetch_ohlcv(C.SYMBOL, C.TIMEFRAME, 365)
    folds = walk_forward(df)
    if folds:
        pos = sum(f["ret"] > 0 for f in folds)
        print(f"\nProfitable out-of-sample folds: {pos}/{len(folds)}")
        print(f"Avg out-of-sample return per fold: {sum(f['ret'] for f in folds)/len(folds):+.2%}")
        best, _ = optimize(df[-C.TRAIN_DAYS * 288:], C.N_TRIALS)
        json.dump(best, open("params.json", "w"), indent=2)
        print("Saved latest params to params.json:", best)
