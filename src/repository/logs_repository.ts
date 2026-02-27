import moment from 'moment';

export interface Database {
  prepare(sql: string): Statement;
}

export interface Statement {
  all(parameters?: any): any[];
  run(parameters?: any): void;
}

export class LogsRepository {
  constructor(private db: Database) { }

  async getTotalLogsCount(excludes: string[] = [], searchMessage: string = ''): Promise<number> {
    let sql = 'SELECT COUNT(*) as count from logs';
    const parameters: Record<string, any> = {};
    const conditions: string[] = [];

    if (excludes.length > 0) {
      conditions.push(`level NOT IN (${excludes
        .map((exclude, index) => `$level_${index}`)
        .join(', ')})`);
      excludes.forEach((exclude, index) => {
        parameters[`level_${index}`] = exclude;
      });
    }

    if (searchMessage.trim()) {
      conditions.push(`message LIKE $search`);
      parameters['search'] = `%${searchMessage.trim()}%`;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = this.db.prepare(sql);
    const result = stmt.all(parameters) as { count: number }[];
    return result[0]?.count || 0;
  }

  async getLatestLogs(
    excludes: string[] = ['debug'],
    limit: number = 50,
    offset: number = 0,
    searchMessage: string = ''
  ): Promise<any[]> {
    let sql = `SELECT * from logs`;
    const parameters: Record<string, any> = {};
    const conditions: string[] = [];

    if (excludes.length > 0) {
      conditions.push(`level NOT IN (${excludes
        .map((exclude, index) => `$level_${index}`)
        .join(', ')})`);
      excludes.forEach((exclude, index) => {
        parameters[`level_${index}`] = exclude;
      });
    }

    if (searchMessage.trim()) {
      conditions.push(`message LIKE $search`);
      parameters['search'] = `%${searchMessage.trim()}%`;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` order by created_at DESC LIMIT ${limit} OFFSET ${offset}`;

    const stmt = this.db.prepare(sql);
    return stmt.all(parameters);
  }

  async getLevels(): Promise<string[]> {
    const stmt = this.db.prepare('SELECT level from logs GROUP BY level');
    return stmt.all().map((r: any) => r.level);
  }

  async cleanOldLogEntries(days: number = 7): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM logs WHERE created_at < $created_at');

    stmt.run({
      created_at: moment()
        .subtract(days, 'days')
        .unix()
    });
  }
}
