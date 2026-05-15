import * as ccxt from 'ccxt';
import { CandleImporter } from './candle_importer';
import { DashboardConfigService } from './dashboard_config_service';
import { ExchangeCandlestick } from '../../dict/exchange_candlestick';
import { Logger } from '../services';
import { ProfileService } from '../../profile/profile_service';
import { normalizeDashboardPair } from './dashboard_pair_normalizer';
import type { CcxtCandlePrefillService } from './ccxt_candle_prefill_service';
import { convertPeriodToMinute } from '../../utils/resample';

type SymbolType = 'spot' | 'swap' | 'futures';

function getSymbolType(symbol: string): SymbolType {
  const colonIdx = symbol.indexOf(':');
  if (colonIdx === -1) return 'spot';
  // dated futures have a date suffix like :USDT-260327 or :BTC-260327
  const settlement = symbol.slice(colonIdx + 1);
  if (/-\d{6}$/.test(settlement)) return 'futures';
  return 'swap';
}

export class CcxtCandleWatchService {
  // Shared candle buffer: key = "exchange:symbol:period:time"
  private buffer = new Map<string, ExchangeCandlestick>();
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private fallbackPollers = new Map<string, ReturnType<typeof setTimeout>>();
  private subscriptionHealth = new Map<string, 'healthy' | 'degraded'>();
  // Increment to invalidate all currently-running watcher loops
  private generation = 0;

  constructor(
    private candleImporter: CandleImporter,
    private dashboardConfigService: DashboardConfigService,
    private logger: Logger,
    private profileService: ProfileService,
    private ccxtCandlePrefillService?: CcxtCandlePrefillService
  ) {}

  start(): void {
    this.startFlushInterval();
    this.startSubscriptions();
  }

  /**
   * Returns all unique (exchange, symbol) pairs currently being watched via websocket.
   * Combines pairs from dashboard config and bot configs.
   */
  getWatchedPairs(): { exchange: string; symbol: string }[] {
    const pairSet = new Map<string, { exchange: string; symbol: string }>();

    // Add pairs from dashboard config
    const config = this.dashboardConfigService.getConfig();
    for (const pair of config.pairs) {
      const normalizedPair = normalizeDashboardPair(pair);
      const key = `${normalizedPair.exchange}:${normalizedPair.symbol}`;
      pairSet.set(key, { exchange: normalizedPair.exchange, symbol: normalizedPair.symbol });
    }

    // Add pairs from bot configs
    for (const profile of this.profileService.getProfiles()) {
      for (const bot of profile.bots || []) {
        const key = `${profile.exchange}:${bot.pair}`;
        pairSet.set(key, { exchange: profile.exchange, symbol: bot.pair });
      }
      for (const bot of profile.botsV2 || []) {
        const key = `${profile.exchange}:${bot.pair}`;
        pairSet.set(key, { exchange: profile.exchange, symbol: bot.pair });
      }
    }

    return Array.from(pairSet.values());
  }

  /**
   * Returns true if the given exchange+symbol+period is currently subscribed
   * via the websocket (i.e. it is present in the dashboard config or any bot config).
   */
  isWatched(exchange: string, symbol: string, period: string): boolean {
    // Check dashboard config (cross-product of pairs × periods)
    const config = this.dashboardConfigService.getConfig();
    if (
      config.pairs.some(p => {
        const normalizedPair = normalizeDashboardPair(p);
        return normalizedPair.exchange === exchange && normalizedPair.symbol === symbol;
      }) &&
      config.periods.includes(period)
    ) {
      return true;
    }
    // Check bot configs (each bot specifies a specific exchange+symbol+period triple)
    for (const profile of this.profileService.getProfiles()) {
      if (profile.exchange !== exchange) continue;
      for (const bot of profile.bots || []) {
        if (bot.pair === symbol && bot.interval === period) {
          return true;
        }
      }
      for (const bot of profile.botsV2 || []) {
        if (bot.pair === symbol && bot.interval === period) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Called when dashboard settings are saved. Stops old subscriptions and
   * starts new ones reflecting the updated pairs/periods configuration.
   */
  restart(): void {
    this.generation++;
    this.resetRuntimeState();
    this.logger.debug(`[CcxtCandleWatch] Restarting subscriptions`);
    this.startSubscriptions();
  }

  stop(): void {
    this.generation++;
    this.resetRuntimeState();
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  isSubscriptionHealthy(exchange: string, symbol: string, period: string): boolean {
    return this.subscriptionHealth.get(this.subscriptionKey(exchange, symbol, period)) !== 'degraded';
  }

  async recoverSubscription(exchange: string, symbol: string, period: string): Promise<void> {
    await this.markPairsDegraded(exchange, [[symbol, period]]);
  }

  private startFlushInterval(): void {
    if (this.flushInterval) clearInterval(this.flushInterval);
    this.flushInterval = setInterval(() => this.flush(), 5000);
  }

  private async flush(): Promise<void> {
    if (this.buffer.size === 0) return;
    const candles = Array.from(this.buffer.values());
    this.buffer.clear();
    try {
      await this.candleImporter.insertCandles(candles);

    } catch (e: any) {
      this.logger.error(`[CcxtCandleWatch] Flush error: ${e.message || String(e)}`);
    }
  }

  private resetRuntimeState(): void {
    for (const timer of this.fallbackPollers.values()) {
      clearTimeout(timer);
    }
    this.fallbackPollers.clear();
    this.subscriptionHealth.clear();
  }

  private startSubscriptions(): void {
    // Collect all (exchange, symbol, period) triples from dashboard config and bots, deduped.
    // Dashboard: cross-product of configured pairs × periods.
    // Bots: each bot contributes one specific (profile.exchange, bot.pair, bot.interval) triple.
    const allSubs = new Map<string, { exchange: string; symbol: string; period: string }>();
    const addSub = (exchange: string, symbol: string, period: string): void => {
      allSubs.set(`${exchange}\0${symbol}\0${period}`, { exchange, symbol, period });
    };

    const config = this.dashboardConfigService.getConfig();
    for (const pair of config.pairs) {
      const normalizedPair = normalizeDashboardPair(pair);
      for (const period of config.periods) {
        addSub(normalizedPair.exchange, normalizedPair.symbol, period);
      }
    }

    for (const profile of this.profileService.getProfiles()) {
      for (const bot of profile.bots || []) {
        addSub(profile.exchange, bot.pair, bot.interval);
      }
      for (const bot of profile.botsV2 || []) {
        addSub(profile.exchange, bot.pair, bot.interval);
      }
    }

    if (allSubs.size === 0) {
      this.logger.debug('[CcxtCandleWatch] No pairs configured, skipping subscriptions');
      return;
    }

    // Group by exchange + symbol type so each group gets its own ccxt.pro instance.
    // Spot, swap (perpetual), and dated futures require separate instances.
    type GroupKey = string; // "exchange:type"
    const groups = new Map<GroupKey, { exchange: string; symbolPeriodPairs: Map<string, [string, string]> }>();

    for (const { exchange, symbol, period } of allSubs.values()) {
      const type = getSymbolType(symbol);
      const key = `${exchange}:${type}`;
      if (!groups.has(key)) {
        groups.set(key, { exchange, symbolPeriodPairs: new Map() });
      }
      groups.get(key)!.symbolPeriodPairs.set(`${symbol}\0${period}`, [symbol, period]);
    }

    const myGen = this.generation;

    for (const [, group] of groups) {
      const symbolPeriodPairs: [string, string][] = Array.from(group.symbolPeriodPairs.values());
      for (const [symbol, period] of symbolPeriodPairs) {
        this.subscriptionHealth.set(this.subscriptionKey(group.exchange, symbol, period), 'healthy');
      }
      this.runWatcher(group.exchange, symbolPeriodPairs, myGen);
    }

    this.logger.debug(
      `[CcxtCandleWatch] Started ${groups.size} watcher(s) for ${allSubs.size} pair+period combination(s)`
    );
  }

  private async runWatcher(exchangeId: string, pairs: [string, string][], gen: number): Promise<void> {
    const ExchangeClass = (ccxt.pro as any)[exchangeId];
    if (!ExchangeClass) {
      this.logger.error(`[CcxtCandleWatch] Exchange "${exchangeId}" not found in ccxt.pro`);
      return;
    }

    const instance: any = new ExchangeClass({ newUpdates: true });

    while (gen === this.generation) {
      try {
        const update = await instance.watchOHLCVForSymbols(pairs);

        if (gen !== this.generation) break;
        await this.markPairsHealthy(exchangeId, pairs);

        for (const [symbol, periodMap] of Object.entries(update as Record<string, Record<string, number[][]>>)) {
          for (const [period, candleList] of Object.entries(periodMap)) {
            for (const c of candleList) {
              const time = Math.floor(c[0] / 1000);
              const key = `${exchangeId}:${symbol}:${period}:${time}`;
              this.buffer.set(
                key,
                new ExchangeCandlestick(exchangeId, symbol, period, time, c[1], c[2], c[3], c[4], c[5])
              );
            }
          }
        }
      } catch (e: any) {
        if (gen !== this.generation) break;
        await this.markPairsDegraded(exchangeId, pairs);
        this.logger.error(`[CcxtCandleWatch] ${exchangeId} watcher error: ${e.message || String(e)}`);
        // Back off before retrying so we don't spin on persistent errors
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    try {
      await instance.close();
    } catch (_) {
      // ignore close errors
    }

    this.logger.debug(`[CcxtCandleWatch] Watcher stopped: ${exchangeId}`);
  }

  private subscriptionKey(exchange: string, symbol: string, period: string): string {
    return `${exchange}\0${symbol}\0${period}`;
  }

  private pollingDelayMs(period: string): number {
    const periodMs = convertPeriodToMinute(period) * 60 * 1000;
    return Math.max(15000, Math.min(periodMs, 60000));
  }

  private async markPairsHealthy(exchangeId: string, pairs: [string, string][]): Promise<void> {
    for (const [symbol, period] of pairs) {
      const key = this.subscriptionKey(exchangeId, symbol, period);
      if (this.subscriptionHealth.get(key) === 'degraded') {
        this.logger.info(`[CcxtCandleWatch] ${exchangeId}:${symbol}:${period} websocket recovered; stopping REST fallback`);
      }
      this.subscriptionHealth.set(key, 'healthy');
      this.stopFallbackPolling(key);
    }
  }

  private async markPairsDegraded(exchangeId: string, pairs: [string, string][]): Promise<void> {
    for (const [symbol, period] of pairs) {
      const key = this.subscriptionKey(exchangeId, symbol, period);
      const wasDegraded = this.subscriptionHealth.get(key) === 'degraded';
      this.subscriptionHealth.set(key, 'degraded');
      if (!wasDegraded) {
        this.logger.warn(`[CcxtCandleWatch] ${exchangeId}:${symbol}:${period} websocket degraded; enabling REST fallback`);
      }
      await this.ensureFallbackPolling(exchangeId, symbol, period);
    }
  }

  private stopFallbackPolling(key: string): void {
    const timer = this.fallbackPollers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.fallbackPollers.delete(key);
    }
  }

  private async ensureFallbackPolling(exchange: string, symbol: string, period: string): Promise<void> {
    const key = this.subscriptionKey(exchange, symbol, period);
    if (!this.ccxtCandlePrefillService || this.fallbackPollers.has(key)) {
      return;
    }

    const run = async (): Promise<void> => {
      if (this.subscriptionHealth.get(key) !== 'degraded') {
        this.stopFallbackPolling(key);
        return;
      }

      try {
        const candles = await this.ccxtCandlePrefillService.fetchDirect(exchange, symbol, period);
        if (candles.length > 0) {
          await this.candleImporter.insertCandles(candles);
        }
      } catch (e: any) {
        this.logger.warn(`[CcxtCandleWatch] REST fallback failed for ${exchange}:${symbol}:${period}: ${e.message || String(e)}`);
      }

      if (this.subscriptionHealth.get(key) === 'degraded') {
        const timer = setTimeout(() => {
          this.fallbackPollers.delete(key);
          void this.ensureFallbackPolling(exchange, symbol, period);
        }, this.pollingDelayMs(period));
        this.fallbackPollers.set(key, timer);
      } else {
        this.stopFallbackPolling(key);
      }
    };

    await run();
  }
}
