export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  all(parameters?: any): any[];
  run(parameters?: any): void;
}

export class SignalRepository {
  constructor(private db: Database) {}

  async getSignals(since: number): Promise<any[]> {
    const stmt = this.db.prepare('SELECT * from signals where income_at > ? order by income_at DESC LIMIT 100');
    return stmt.all(since);
  }

  insertSignal(exchange: string, symbol: string, options: Record<string, any>, side: string, strategy: string, interval?: string): void {
    const stmt = this.db.prepare(
      'INSERT INTO signals(exchange, symbol, options, side, strategy, interval, income_at) VALUES ($exchange, $symbol, $options, $side, $strategy, $interval, $income_at)'
    );

    stmt.run({
      exchange: exchange,
      symbol: symbol,
      options: JSON.stringify(options || {}),
      side: side,
      strategy: strategy,
      interval: interval || null,
      income_at: Math.floor(Date.now() / 1000)
    });
  }
}
