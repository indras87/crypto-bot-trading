export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  all(parameters?: any): any[];
  get(parameters?: any): any;
  run(parameters?: any): void;
}

export interface BacktestRunRecord {
  id?: number;
  run_group_id: string;
  run_type: 'single' | 'multi';
  exchange: string;
  symbol: string;
  period: string;
  hours: number;
  strategy: string;
  strategy_options_json?: string;
  initial_capital: number;
  use_ai: number;
  start_time: number;
  end_time: number;
  total_trades: number;
  profitable_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit_percent: number;
  average_profit_percent: number;
  max_drawdown: number;
  sharpe_ratio: number;
  created_at: number;
}

export interface BacktestRunQueryParams {
  strategy?: string;
  exchange?: string;
  symbol?: string;
  period?: string;
  runType?: 'single' | 'multi';
  useAi?: '0' | '1';
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

const SORT_COLUMNS: Record<string, string> = {
  roi: 'total_profit_percent',
  win_rate: 'win_rate',
  sharpe: 'sharpe_ratio',
  max_drawdown: 'max_drawdown',
  trades: 'total_trades',
  created_at: 'created_at'
};

export class BacktestRunRepository {
  constructor(private db: Database) {}

  create(record: BacktestRunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO backtest_runs(
        run_group_id, run_type, exchange, symbol, period, hours,
        strategy, strategy_options_json, initial_capital, use_ai,
        start_time, end_time, total_trades, profitable_trades, losing_trades,
        win_rate, total_profit_percent, average_profit_percent, max_drawdown,
        sharpe_ratio, created_at
      ) VALUES (
        $run_group_id, $run_type, $exchange, $symbol, $period, $hours,
        $strategy, $strategy_options_json, $initial_capital, $use_ai,
        $start_time, $end_time, $total_trades, $profitable_trades, $losing_trades,
        $win_rate, $total_profit_percent, $average_profit_percent, $max_drawdown,
        $sharpe_ratio, $created_at
      )
    `);

    stmt.run(record);
  }

  createMany(records: BacktestRunRecord[]): void {
    if (records.length === 0) {
      return;
    }

    for (const record of records) {
      this.create(record);
    }
  }

  async findWithFilters(params: BacktestRunQueryParams): Promise<BacktestRunRecord[]> {
    const { whereSql, bindParams } = this.buildWhereClause(params);
    const sortColumn = SORT_COLUMNS[params.sortBy || 'roi'] || SORT_COLUMNS.roi;
    const sortDir = params.sortDir === 'asc' ? 'ASC' : 'DESC';
    const page = Math.max(params.page || 1, 1);
    const limit = Math.min(Math.max(params.limit || 50, 1), 200);
    const offset = (page - 1) * limit;

    const stmt = this.db.prepare(`
      SELECT * FROM backtest_runs
      ${whereSql}
      ORDER BY ${sortColumn} ${sortDir}, created_at DESC
      LIMIT $limit OFFSET $offset
    `);

    return stmt.all({
      ...bindParams,
      limit,
      offset
    });
  }

  async countWithFilters(params: BacktestRunQueryParams): Promise<number> {
    const { whereSql, bindParams } = this.buildWhereClause(params);

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as total FROM backtest_runs
      ${whereSql}
    `);

    const result = stmt.get(bindParams) as { total: number } | undefined;
    return result?.total || 0;
  }

  private buildWhereClause(params: BacktestRunQueryParams): { whereSql: string; bindParams: Record<string, any> } {
    const clauses: string[] = [];
    const bindParams: Record<string, any> = {};

    if (params.strategy) {
      clauses.push('strategy = $strategy');
      bindParams.strategy = params.strategy;
    }

    if (params.exchange) {
      clauses.push('exchange = $exchange');
      bindParams.exchange = params.exchange;
    }

    if (params.symbol) {
      clauses.push('symbol LIKE $symbol');
      bindParams.symbol = `%${params.symbol}%`;
    }

    if (params.period) {
      clauses.push('period = $period');
      bindParams.period = params.period;
    }

    if (params.runType) {
      clauses.push('run_type = $runType');
      bindParams.runType = params.runType;
    }

    if (params.useAi === '0' || params.useAi === '1') {
      clauses.push('use_ai = $useAi');
      bindParams.useAi = parseInt(params.useAi, 10);
    }

    if (params.q) {
      clauses.push('(strategy LIKE $q OR symbol LIKE $q OR exchange LIKE $q)');
      bindParams.q = `%${params.q}%`;
    }

    return {
      whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      bindParams
    };
  }
}
