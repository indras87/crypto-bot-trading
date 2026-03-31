export const DATABASE_SCHEMA = `
PRAGMA auto_vacuum = INCREMENTAL;

CREATE TABLE IF NOT EXISTS candlesticks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange   VARCHAR(255) NULL,
  symbol     VARCHAR(255) NULL,
  period     VARCHAR(255) NULL,
  time       INTEGER          NULL,
  open       REAL         NULL,
  high       REAL         NULL,
  low        REAL         NULL,
  close      REAL         NULL,
  volume     REAL         NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_candle
  ON candlesticks (exchange, symbol, period, time);

CREATE INDEX IF NOT EXISTS time_idx ON candlesticks (time);
CREATE INDEX IF NOT EXISTS exchange_symbol_idx ON candlesticks (exchange, symbol);

CREATE TABLE IF NOT EXISTS candlesticks_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  income_at  BIGINT       NULL,
  exchange   VARCHAR(255) NULL,
  symbol     VARCHAR(255) NULL,
  period     VARCHAR(255) NULL,
  time       INTEGER      NULL,
  open       REAL         NULL,
  high       REAL         NULL,
  low        REAL         NULL,
  close      REAL         NULL,
  volume     REAL         NULL
);

CREATE INDEX IF NOT EXISTS candle_idx ON candlesticks_log (exchange, symbol, period, time);

CREATE TABLE IF NOT EXISTS ticker (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange   VARCHAR(255) NULL,
  symbol     VARCHAR(255) NULL,
  ask        REAL         NULL,
  bid        REAL         NULL,
  updated_at INT          NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ticker_unique
  ON ticker (exchange, symbol);

CREATE TABLE IF NOT EXISTS ticker_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange   VARCHAR(255) NULL,
  symbol     VARCHAR(255) NULL,
  ask        REAL         NULL,
  bid        REAL         NULL,
  income_at  BIGINT       NULL
);
CREATE INDEX IF NOT EXISTS ticker_log_idx ON ticker_log (exchange, symbol);
CREATE INDEX IF NOT EXISTS ticker_log_time_idx ON ticker_log (exchange, symbol, income_at);

CREATE TABLE IF NOT EXISTS signals (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange   VARCHAR(255) NULL,
  symbol     VARCHAR(255) NULL,
  ask        REAL         NULL,
  bid        REAL         NULL,
  options    TEXT         NULL,
  side       VARCHAR(50)  NULL,
  strategy   VARCHAR(50)  NULL,
  interval   VARCHAR(20)  NULL,
  income_at  BIGINT       NULL,
  state      VARCHAR(50)  NULL
);
CREATE INDEX IF NOT EXISTS symbol_idx ON signals (exchange, symbol);

CREATE TABLE IF NOT EXISTS position_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      VARCHAR(64)  NULL,
  profile_name    VARCHAR(255) NULL,
  bot_id          VARCHAR(64)  NULL,
  bot_name        VARCHAR(255) NULL,
  exchange        VARCHAR(255) NULL,
  symbol          VARCHAR(255) NULL,
  side            VARCHAR(50)  NULL,
  entry_price     REAL         NULL,
  contracts       REAL         NULL,
  opened_at       BIGINT       NULL,
  closed_at       BIGINT       NULL,
  exit_price      REAL         NULL,
  realized_pnl    REAL         NULL,
  fee             REAL         NULL,
  closure_type    VARCHAR(20)  NOT NULL DEFAULT 'trade',
  status          VARCHAR(20)  NULL
);
CREATE INDEX IF NOT EXISTS pos_history_profile ON position_history (profile_id);
CREATE INDEX IF NOT EXISTS pos_history_symbol ON position_history (symbol);
CREATE INDEX IF NOT EXISTS pos_history_status ON position_history (status);

CREATE TABLE IF NOT EXISTS logs (
  uuid       VARCHAR(64) PRIMARY KEY,
  level      VARCHAR(32) NOT NULL,
  message    TEXT NULL,
  created_at INT NOT NULL
);

CREATE INDEX IF NOT EXISTS created_at_idx ON logs (created_at);
CREATE INDEX IF NOT EXISTS level_created_at_idx ON logs (level, created_at);
CREATE INDEX IF NOT EXISTS level_idx ON logs (level);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_group_id           VARCHAR(64)  NOT NULL,
  run_type               VARCHAR(20)  NOT NULL,
  exchange               VARCHAR(255) NOT NULL,
  symbol                 VARCHAR(255) NOT NULL,
  period                 VARCHAR(20)  NOT NULL,
  hours                  INTEGER      NOT NULL,
  strategy               VARCHAR(120) NOT NULL,
  strategy_options_json  TEXT         NULL,
  initial_capital        REAL         NOT NULL,
  use_ai                 INTEGER      NOT NULL,
  start_time             BIGINT       NOT NULL,
  end_time               BIGINT       NOT NULL,
  total_trades           INTEGER      NOT NULL,
  profitable_trades      INTEGER      NOT NULL,
  losing_trades          INTEGER      NOT NULL,
  win_rate               REAL         NOT NULL,
  total_profit_percent   REAL         NOT NULL,
  average_profit_percent REAL         NOT NULL,
  max_drawdown           REAL         NOT NULL,
  sharpe_ratio           REAL         NOT NULL,
  profit_factor          REAL         NOT NULL DEFAULT 0,
  expectancy_percent     REAL         NOT NULL DEFAULT 0,
  calmar_ratio           REAL         NOT NULL DEFAULT 0,
  metrics_confidence     VARCHAR(16)  NOT NULL DEFAULT 'low',
  metrics_confidence_reason TEXT      NULL,
  created_at             BIGINT       NOT NULL
);

CREATE INDEX IF NOT EXISTS backtest_runs_created_at_idx ON backtest_runs (created_at);
CREATE INDEX IF NOT EXISTS backtest_runs_strategy_created_idx ON backtest_runs (strategy, created_at);
CREATE INDEX IF NOT EXISTS backtest_runs_symbol_idx ON backtest_runs (exchange, symbol, period);
CREATE INDEX IF NOT EXISTS backtest_runs_roi_idx ON backtest_runs (total_profit_percent);
CREATE INDEX IF NOT EXISTS backtest_runs_sharpe_idx ON backtest_runs (sharpe_ratio);
CREATE INDEX IF NOT EXISTS backtest_runs_drawdown_idx ON backtest_runs (max_drawdown);
CREATE INDEX IF NOT EXISTS backtest_runs_group_idx ON backtest_runs (run_group_id);

CREATE TABLE IF NOT EXISTS ai_signal_decisions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id            VARCHAR(64)   NOT NULL,
  bot_id                VARCHAR(64)   NOT NULL,
  exchange              VARCHAR(255)  NOT NULL,
  symbol                VARCHAR(255)  NOT NULL,
  timeframe             VARCHAR(20)   NOT NULL,
  signal                VARCHAR(20)   NOT NULL,
  action                VARCHAR(20)   NOT NULL,
  confidence            REAL          NOT NULL,
  confirmed             INTEGER       NOT NULL,
  risk_level            VARCHAR(20)   NULL,
  reason_code           VARCHAR(120)  NULL,
  reasoning             TEXT          NULL,
  indicator_json        TEXT          NULL,
  created_at            BIGINT        NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_signal_decisions_bot_time_idx ON ai_signal_decisions (profile_id, bot_id, created_at);

CREATE TABLE IF NOT EXISTS bot_risk_state (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id            VARCHAR(64)   NOT NULL,
  bot_id                VARCHAR(64)   NOT NULL,
  max_drawdown_pct      REAL          NOT NULL,
  equity_peak           REAL          NOT NULL,
  current_equity        REAL          NOT NULL,
  current_drawdown_pct  REAL          NOT NULL,
  paused                INTEGER       NOT NULL DEFAULT 0,
  pause_reason          TEXT          NULL,
  updated_at            BIGINT        NOT NULL,
  UNIQUE(profile_id, bot_id)
);

CREATE TABLE IF NOT EXISTS policy_snapshots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id            VARCHAR(64)   NOT NULL,
  bot_id                VARCHAR(64)   NOT NULL,
  policy_version        INTEGER       NOT NULL,
  ai_min_confidence     REAL          NOT NULL,
  strategy_options_json TEXT          NULL,
  objective_score       REAL          NOT NULL,
  source                VARCHAR(40)   NOT NULL,
  created_at            BIGINT        NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_snapshots_unique_version_idx ON policy_snapshots (profile_id, bot_id, policy_version);
CREATE INDEX IF NOT EXISTS policy_snapshots_bot_time_idx ON policy_snapshots (profile_id, bot_id, created_at);

CREATE TABLE IF NOT EXISTS policy_updates (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id            VARCHAR(64)   NOT NULL,
  bot_id                VARCHAR(64)   NOT NULL,
  previous_version      INTEGER       NOT NULL,
  next_version          INTEGER       NOT NULL,
  previous_confidence   REAL          NOT NULL,
  next_confidence       REAL          NOT NULL,
  objective_before      REAL          NOT NULL,
  objective_after       REAL          NOT NULL,
  accepted              INTEGER       NOT NULL,
  reason                TEXT          NULL,
  created_at            BIGINT        NOT NULL
);
CREATE INDEX IF NOT EXISTS policy_updates_bot_time_idx ON policy_updates (profile_id, bot_id, created_at);
`;
