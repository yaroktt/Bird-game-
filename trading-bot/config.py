"""Settings. FIXED limits are set by you and never touched by the optimizer."""

SYMBOL = "BTC/USDT"
TIMEFRAME = "5m"
FEE = 0.001  # 0.1% per side (OKX taker is ~0.1%); includes in every backtest

# --- Fixed risk limits (optimizer can NOT change these) ---
MAX_POSITION_FRACTION = 0.25   # never put more than 25% of equity in one trade
DAILY_LOSS_LIMIT = 0.03        # bot shuts off for the day after -3% equity
STARTING_CASH = 10_000.0

# --- Optimizer search ranges ---
RANGES = {
    "short_ma": (5, 50),
    "long_ma": (20, 200),
    "atr_period": (7, 30),
    "atr_stop_mult": (1.0, 5.0),   # stop distance = mult * ATR
    "take_profit_atr_mult": (1.0, 10.0),
}

# --- Walk-forward ---
TRAIN_DAYS = 90
TEST_DAYS = 30
N_TRIALS = 200
MAX_DD_PENALTY = 2.0           # score = sharpe - penalty * max_drawdown

# --- Re-tune guard: max relative change of any setting per re-tune ---
MAX_PARAM_CHANGE = 0.30
