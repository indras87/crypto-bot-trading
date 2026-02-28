import { CandleImporter } from './candle_importer';
import { ExchangeCandlestick } from '../../dict/exchange_candlestick';
import { Logger } from '../services';
import { ExchangeInstanceService } from './exchange_instance_service';
import { CandlestickRepository } from '../../repository';
import { convertPeriodToMinute } from '../../utils/resample';

// [exchange, symbol, period]
export type PrefillJob = [string, string, string];

const CANDLES_LIMIT = 500;

// Delay between pagination requests to respect exchange rate limits (ms)
const PAGINATION_DELAY_MS = 300;

export class CcxtCandlePrefillService {
  private queue: PrefillJob[] = [];
  private running = false;

  constructor(
    private candleImporter: CandleImporter,
    private logger: Logger,
    private exchangeInstanceService: ExchangeInstanceService,
    private candlestickRepository?: CandlestickRepository,
  ) {}

  enqueue(jobs: PrefillJob[]): void {
    const newJobs = jobs.filter(j => !this.queue.some(q => this.key(q) === this.key(j)));
    if (newJobs.length === 0) return;

    this.queue.push(...newJobs);
    this.logger.debug(`[CcxtCandlePrefill] Queued ${newJobs.length} jobs (${this.queue.length} pending)`);
    this.processQueue();
  }

  isRunning(): boolean {
    return this.running;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  private key([exchange, symbol, period]: PrefillJob): string {
    return `${exchange}:${symbol}:${period}`;
  }

  private processQueue(): void {
    if (this.running) return;
    this.running = true;

    // Fire and forget — errors are logged, never thrown
    this.runLoop().finally(() => {
      this.running = false;
    });
  }

  private async runLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;

      try {
        const count = await this.fetchAndStore(job);
        this.logger.debug(`[CcxtCandlePrefill] ${this.key(job)}: stored ${count} candles (${this.queue.length} remaining)`);
      } catch (e: any) {
        this.logger.error(`[CcxtCandlePrefill] ${this.key(job)}: ${e.message || String(e)}`, { job });
      }
    }
  }

  /**
   * Fetch 500 candles from the exchange REST API and return them immediately.
   * No DB storage — caller uses the candles directly.
   */
  async fetchDirect(exchange: string, symbol: string, period: string): Promise<ExchangeCandlestick[]> {
    return this.fetchRaw(exchange, symbol, period);
  }

  /**
   * Ensure that candles for the given time range are available in the database.
   * If the DB does not have enough candles, fetches historical data from the exchange
   * using pagination and stores them in the DB.
   *
   * @param exchange - Exchange name
   * @param symbol - Trading pair symbol
   * @param period - Candle period (e.g. '1h', '15m')
   * @param since - Start unix timestamp in seconds
   * @param until - End unix timestamp in seconds
   * @returns Number of candles fetched and stored from exchange (0 if DB already had enough data)
   */
  async ensureCandlesForBacktest(
    exchange: string,
    symbol: string,
    period: string,
    since: number,
    until: number
  ): Promise<number> {
    if (!this.candlestickRepository) {
      this.logger.warn('[CcxtCandlePrefill] candlestickRepository not available — skipping historical fetch');
      return 0;
    }

    // Calculate expected number of candles for the time range
    const periodMinutes = convertPeriodToMinute(period);
    const rangeSeconds = until - since;
    const expectedCandles = Math.floor(rangeSeconds / (periodMinutes * 60));

    // Check how many candles we already have in DB for this range
    const existingCandles = await this.candlestickRepository.getLookbacksSince(exchange, symbol, period, since);
    const existingInRange = existingCandles.filter(c => c.time >= since && c.time <= until);

    // If we have at least 90% of expected candles, consider DB sufficient
    const coverageRatio = expectedCandles > 0 ? existingInRange.length / expectedCandles : 0;
    if (coverageRatio >= 0.9) {
      this.logger.debug(
        `[CcxtCandlePrefill] ${exchange}:${symbol}:${period} DB has ${existingInRange.length}/${expectedCandles} candles (${(coverageRatio * 100).toFixed(0)}%) — skipping fetch`
      );
      return 0;
    }

    this.logger.info(
      `[CcxtCandlePrefill] ${exchange}:${symbol}:${period} DB has ${existingInRange.length}/${expectedCandles} candles — fetching historical data from exchange`
    );

    try {
      const candles = await this.fetchHistoricalCandles(exchange, symbol, period, since, until);

      if (candles.length > 0) {
        await this.candleImporter.insertCandles(candles);
        this.logger.info(`[CcxtCandlePrefill] ${exchange}:${symbol}:${period} stored ${candles.length} historical candles`);
      }

      return candles.length;
    } catch (e: any) {
      this.logger.error(
        `[CcxtCandlePrefill] Failed to fetch historical candles for ${exchange}:${symbol}:${period}: ${e.message || String(e)}`
      );
      // Don't throw — backtest will proceed with whatever data is in DB
      return 0;
    }
  }

  /**
   * Fetch historical candles from exchange using pagination.
   * Fetches batches of CANDLES_LIMIT candles starting from `since` until `until`.
   *
   * @param exchange - Exchange name
   * @param symbol - Trading pair symbol
   * @param period - Candle period
   * @param since - Start unix timestamp in seconds
   * @param until - End unix timestamp in seconds
   * @returns All fetched candles as ExchangeCandlestick[]
   */
  private async fetchHistoricalCandles(
    exchange: string,
    symbol: string,
    period: string,
    since: number,
    until: number
  ): Promise<ExchangeCandlestick[]> {
    const ccxtExchange = await this.exchangeInstanceService.getPublicExchange(exchange);
    const allCandles: ExchangeCandlestick[] = [];

    // CCXT fetchOHLCV uses milliseconds for the `since` parameter
    let currentSinceMs = since * 1000;
    const untilMs = until * 1000;

    let batchCount = 0;
    const MAX_BATCHES = 200; // Safety limit: 200 * 500 = 100,000 candles max

    while (batchCount < MAX_BATCHES) {
      batchCount++;

      let ohlcv: number[][];
      try {
        ohlcv = (await ccxtExchange.fetchOHLCV(symbol, period, currentSinceMs, CANDLES_LIMIT)) as number[][];
      } catch (e: any) {
        this.logger.warn(
          `[CcxtCandlePrefill] fetchOHLCV failed for ${exchange}:${symbol}:${period} at batch ${batchCount}: ${e.message || String(e)}`
        );
        break;
      }

      if (!ohlcv || ohlcv.length === 0) {
        break;
      }

      // Filter candles within the requested range and drop the last (possibly forming) candle
      const batch = ohlcv
        .slice(0, -1) // drop last candle — may still be forming
        .filter(c => c[0] >= since * 1000 && c[0] <= untilMs)
        .map(
          c =>
            new ExchangeCandlestick(
              exchange,
              symbol,
              period,
              Math.floor(c[0] / 1000),
              c[1],
              c[2],
              c[3],
              c[4],
              c[5]
            )
        );

      allCandles.push(...batch);

      this.logger.debug(
        `[CcxtCandlePrefill] ${exchange}:${symbol}:${period} batch ${batchCount}: fetched ${ohlcv.length} candles, kept ${batch.length} (total: ${allCandles.length})`
      );

      // Stop conditions:
      // 1. Exchange returned fewer candles than requested — no more data available
      if (ohlcv.length < CANDLES_LIMIT) {
        break;
      }

      // 2. Last candle in batch is past our `until` time
      const lastCandleTimeMs = ohlcv[ohlcv.length - 1][0];
      if (lastCandleTimeMs >= untilMs) {
        break;
      }

      // Advance to next batch: start from the timestamp after the last candle
      currentSinceMs = lastCandleTimeMs + 1;

      // Respect exchange rate limits
      await new Promise(r => setTimeout(r, PAGINATION_DELAY_MS));
    }

    if (batchCount >= MAX_BATCHES) {
      this.logger.warn(
        `[CcxtCandlePrefill] ${exchange}:${symbol}:${period} reached MAX_BATCHES limit (${MAX_BATCHES}) — fetched ${allCandles.length} candles`
      );
    }

    return allCandles;
  }

  private async fetchAndStore([exchange, symbol, period]: PrefillJob): Promise<number> {
    const candles = await this.fetchRaw(exchange, symbol, period);
    await this.candleImporter.insertCandles(candles);
    return candles.length;
  }

  private async fetchRaw(exchange: string, symbol: string, period: string): Promise<ExchangeCandlestick[]> {
    const ccxtExchange = await this.exchangeInstanceService.getPublicExchange(exchange);

    const ohlcv = await ccxtExchange.fetchOHLCV(symbol, period, undefined, CANDLES_LIMIT) as number[][];

    // Drop the last candle — it may still be forming
    const complete = ohlcv.slice(0, -1);

    return complete.map(c => new ExchangeCandlestick(
      exchange,
      symbol,
      period,
      Math.floor(c[0] / 1000),
      c[1],
      c[2],
      c[3],
      c[4],
      c[5]
    ));
  }
}
