export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  all(parameters?: any): any[];
  run(parameters?: any): void;
}

export interface PositionHistoryRecord {
  id?: number;
  profile_id: string;
  profile_name: string;
  bot_id: string;
  bot_name: string;
  exchange: string;
  symbol: string;
  side: string;
  entry_price: number;
  contracts: number;
  opened_at: number;
  closed_at?: number;
  exit_price?: number;
  realized_pnl?: number;
  fee?: number;
  status: 'open' | 'closed';
}

export class PositionHistoryRepository {
  constructor(private db: Database) {}

  async getPositionHistory(profileId?: string, status?: string): Promise<any[]> {
    let query = 'SELECT * FROM position_history WHERE 1=1';
    const params: any = {};

    if (profileId) {
      query += ' AND profile_id = $profileId';
      params.profileId = profileId;
    }
    if (status) {
      query += ' AND status = $status';
      params.status = status;
    }

    query += ' ORDER BY opened_at DESC LIMIT 100';
    const stmt = this.db.prepare(query);
    return stmt.all(params);
  }

  openPosition(record: PositionHistoryRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO position_history(profile_id, profile_name, bot_id, bot_name, exchange, symbol, side, entry_price, contracts, opened_at, status)
      VALUES ($profile_id, $profile_name, $bot_id, $bot_name, $exchange, $symbol, $side, $entry_price, $contracts, $opened_at, $status)
    `);

    stmt.run({
      profile_id: record.profile_id,
      profile_name: record.profile_name,
      bot_id: record.bot_id,
      bot_name: record.bot_name,
      exchange: record.exchange,
      symbol: record.symbol,
      side: record.side,
      entry_price: record.entry_price,
      contracts: record.contracts,
      opened_at: Math.floor(Date.now() / 1000),
      status: 'open'
    });
  }

  closePosition(profileId: string, botId: string, symbol: string, exitPrice: number, realizedPnl: number, fee: number = 0): void {
    const stmt = this.db.prepare(`
      UPDATE position_history
      SET status = 'closed', closed_at = $closed_at, exit_price = $exit_price, realized_pnl = $realized_pnl, fee = $fee
      WHERE profile_id = $profile_id AND bot_id = $bot_id AND symbol = $symbol AND status = 'open'
    `);

    stmt.run({
      profile_id: profileId,
      bot_id: botId,
      symbol: symbol,
      closed_at: Math.floor(Date.now() / 1000),
      exit_price: exitPrice,
      realized_pnl: realizedPnl,
      fee: fee
    });
  }

  getOpenPositions(profileId?: string): any[] {
    let query = "SELECT * FROM position_history WHERE status = 'open'";
    const params: any = {};

    if (profileId) {
      query += ' AND profile_id = $profileId';
      params.profileId = profileId;
    }

    query += ' ORDER BY opened_at DESC';
    const stmt = this.db.prepare(query);
    return stmt.all(params);
  }
}
