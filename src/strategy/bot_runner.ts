import { Notify } from '../notify/notify';
import { Logger } from '../modules/services';
import { SignalRepository, PositionHistoryRepository } from '../repository';
import { ProfileService } from '../profile/profile_service';
import { StrategyExecutor } from '../modules/strategy/v2/typed_backtest';
import type { Bot, Profile, PositionInfo } from '../profile/types';

/** Convert a period string (e.g. "15m", "4h", "1d") to whole minutes. */
function periodToMinutes(period: string): number {
  const unit = period.slice(-1).toLowerCase();
  const num = parseInt(period.slice(0, -1), 10);
  switch (unit) {
    case 'm':
      return num;
    case 'h':
      return num * 60;
    case 'd':
      return num * 60 * 24;
    default:
      throw new Error(`BotRunner: unsupported period unit "${unit}" in "${period}"`);
  }
}

/**
 * CCXT uses a colon in the pair symbol to denote futures/swap markets,
 * e.g. "BTC/USDT:USDT". Spot pairs have no colon: "BTC/USDT".
 */
function isFuturesPair(pair: string): boolean {
  return pair.includes(':');
}

type LivePositionSide = 'flat' | 'long' | 'short';

export class BotRunner {
  private started = false;

  constructor(
    private readonly profileService: ProfileService,
    private readonly strategyExecutor: StrategyExecutor,
    private readonly notifier: Notify,
    private readonly signalRepository: SignalRepository,
    private readonly positionHistoryRepository: PositionHistoryRepository,
    private readonly logger: Logger
  ) {}

  // ==================== Notification Helpers ====================

  private notifyOrderOk(
    profile: Profile,
    bot: Bot,
    mode: 'live' | 'paper',
    signal: 'long' | 'short' | 'close',
    price: number | undefined,
    amount: number | undefined,
    contracts: number | undefined,
    orderId: string | undefined
  ): void {
    const priceStr = price !== undefined && price > 0 ? price.toFixed(8) : 'n/a';
    const amountStr = amount !== undefined && amount > 0 ? amount.toFixed(8) : 'n/a';
    const contractsStr = contracts !== undefined && contracts > 0 ? contracts.toFixed(8) : 'n/a';
    const orderIdStr = orderId || 'n/a';

    const message = `[ORDER_OK] profile=${profile.name} bot=${bot.name} mode=${mode} strategy=${bot.strategy} pair=${profile.exchange}:${bot.pair} signal=${signal} price=${priceStr} amount=${amountStr} contracts=${contractsStr} orderId=${orderIdStr}`;

    this.notifier.send(message);
    this.logger.info(`BotRunner: ${message}`);
  }

  private notifyOrderFail(
    profile: Profile,
    bot: Bot,
    mode: 'live' | 'paper',
    signal: 'long' | 'short' | 'close',
    error: string
  ): void {
    const message = `[ORDER_FAIL] profile=${profile.name} bot=${bot.name} mode=${mode} strategy=${bot.strategy} pair=${profile.exchange}:${bot.pair} signal=${signal} error="${error}"`;

    this.notifier.send(message);
    this.logger.error(`BotRunner: ${message}`);
  }

  private notifyPnl(
    profile: Profile,
    bot: Bot,
    mode: 'live' | 'paper',
    side: 'long' | 'short',
    entryPrice: number | undefined,
    exitPrice: number | undefined,
    realizedPnl: number,
    entryNotional: number | undefined
  ): void {
    const entryStr = entryPrice !== undefined && entryPrice > 0 ? entryPrice.toFixed(8) : 'n/a';
    const exitStr = exitPrice !== undefined && exitPrice > 0 ? exitPrice.toFixed(8) : 'n/a';

    let pnlPctStr = 'n/a';
    if (entryNotional !== undefined && entryNotional > 0) {
      const pnlPct = (realizedPnl / entryNotional) * 100;
      pnlPctStr = pnlPct.toFixed(2);
    }

    const message = `[PNL] profile=${profile.name} bot=${bot.name} mode=${mode} pair=${profile.exchange}:${bot.pair} side=${side} entry=${entryStr} exit=${exitStr} pnl=${realizedPnl.toFixed(2)} pnlPct=${pnlPctStr}`;

    this.notifier.send(message);
    this.logger.info(`BotRunner: ${message}`);
  }

  private notifyAutoPause(profile: Profile, bot: Bot, reason: string): void {
    const message = `[AUTO_PAUSE] profile=${profile.name} bot=${bot.name} pair=${profile.exchange}:${bot.pair} reason=${reason}`;

    this.notifier.send(message);
    this.logger.warn(`BotRunner: ${message}`);
  }

  /**
   * Start a single setInterval that fires once per minute, ~8 seconds after
   * the minute boundary (after the 1m candle closed on the exchange).
   *
   * On each tick every running bot is checked: if the current elapsed-minute
   * count is divisible by the bot's period, its strategy is evaluated.
   *
   * Examples at minute 60:  1m ✓  3m ✓  5m ✓  15m ✓  30m ✓  1h ✓
   * Examples at minute 15:  1m ✓  3m ✓  5m ✓  15m ✓  30m ✗  1h ✗
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    const oneMinuteMs = 60_000;
    const now = Date.now();
    const nextBoundary = Math.ceil(now / oneMinuteMs) * oneMinuteMs;
    const delay = nextBoundary - now + 8_000;

    setTimeout(() => {
      this.onTick();
      setInterval(() => this.onTick(), oneMinuteMs);
    }, delay);

    this.logger.info(`BotRunner: first tick in ${(delay / 1000).toFixed(1)}s`);
  }

  private async onTick(): Promise<void> {
    const running = this.getRunningBots();
    if (running.length === 0) return;

    const minutesSinceEpoch = Math.floor(Date.now() / 60_000);

    for (const { bot, profile } of running) {
      let periodMin: number;
      try {
        periodMin = periodToMinutes(bot.interval);
      } catch {
        this.logger.warn(`BotRunner: bot "${bot.name}" has unsupported interval "${bot.interval}", skipping`);
        continue;
      }

      if (minutesSinceEpoch % periodMin !== 0) continue;

      this.logger.info(`BotRunner: triggering "${bot.name}" (${bot.strategy} ${profile.exchange}:${bot.pair} ${bot.interval})`);

      try {
        await this.runBot(bot, profile);
      } catch (err) {
        this.logger.error(`BotRunner: bot "${bot.name}" (${bot.strategy} ${profile.exchange}:${bot.pair}) failed: ${err}`);
      }

      this.logger.info(`BotRunner: triggered "${bot.name}" (${bot.strategy} ${profile.exchange}:${bot.pair} ${bot.interval})`);
    }
  }

  private async runBot(bot: Bot, profile: Profile): Promise<void> {
    const marketData = await this.profileService.fetchTicker(profile.id, bot.pair);

    const isWatchOnly = bot.mode === 'watch';
    const isPaper = !profile.apiKey || !profile.secret;
    const mode: 'live' | 'paper' = isPaper ? 'paper' : 'live';

    // Execute strategy
    const signal = await this.strategyExecutor.executeStrategy(bot.strategy, profile.exchange, bot.pair, bot.interval, bot.options ?? {}, {
      useAiValidator: bot.useAiValidator ?? true
    });

    if (!signal) return;

    this.signalRepository.insertSignal(
      profile.exchange,
      bot.pair,
      { price: marketData.ask, strategy: bot.strategy, interval: bot.interval },
      signal,
      bot.strategy,
      bot.interval
    );

    this.notifier.send(`[${signal} (${bot.strategy})] ${profile.exchange}:${bot.pair} @ ${marketData.ask}`);

    this.logger.info(`BotRunner: signal "${signal}" ${profile.exchange}:${bot.pair} via "${bot.strategy}"`);

    if (!isWatchOnly) {
      if (isPaper) {
        await this.executePaperSignal(bot, profile, signal, marketData);
      } else {
        await this.executeSignal(bot, profile, signal);
      }
    }
  }

  /**
   * Execute a trade signal via CCXT through ProfileService (LIVE mode).
   *
   * close + futures pair  → closePosition() at market
   * close + spot pair     → sell full free balance of the base currency at market
   * long                  → market buy with bot.capital (quote currency)
   * short                 → market sell with bot.capital (quote currency)
   */
  private async executeSignal(bot: Bot, profile: Profile, signal: string): Promise<void> {
    const mode: 'live' = 'live';
    if (isFuturesPair(bot.pair)) {
      await this.executeFuturesSignal(bot, profile, signal, mode);
      return;
    }

    switch (signal) {
      case 'close': {
        try {
          // Spot: sell the full free balance of the base currency
          const baseCurrency = bot.pair.split('/')[0];
          const balances = await this.profileService.fetchBalances(profile);
          const base = balances.find(b => b.currency === baseCurrency);

          if (!base || base.free <= 0) {
            this.logger.warn(`BotRunner: no balance to close for ${bot.pair}`);
            return;
          }

          const orderResult = await this.profileService.placeOrder(profile.id, {
            pair: bot.pair,
            side: 'sell',
            type: 'market',
            amount: base.free,
            isQuoteCurrency: false
          });

          const exitPrice = orderResult.price || 0;
          const exitValue = exitPrice * base.free;
          const entryValue = bot.capital;
          const realizedPnl = exitValue - entryValue;

          // Send ORDER_OK notification
          this.notifyOrderOk(profile, bot, mode, 'close', exitPrice, base.free, undefined, orderResult.id);

          // Send PNL notification
          this.notifyPnl(profile, bot, mode, 'long' as const, undefined, exitPrice, realizedPnl, entryValue);

          this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, exitPrice, realizedPnl, 0);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.notifyOrderFail(profile, bot, mode, 'close', errorMsg);
          throw err;
        }
        break;
      }

      case 'long':
      case 'short': {
        try {
          const orderResult = await this.profileService.placeOrder(profile.id, {
            pair: bot.pair,
            side: signal === 'long' ? 'buy' : 'sell',
            type: 'market',
            amount: bot.capital,
            isQuoteCurrency: true
          });

          const entryPrice = orderResult.price || 0;
          const contracts = orderResult.amount || bot.capital / entryPrice;

          // Send ORDER_OK notification
          this.notifyOrderOk(profile, bot, mode, signal, entryPrice, undefined, contracts, orderResult.id);

          this.positionHistoryRepository.openPosition({
            profile_id: profile.id,
            profile_name: profile.name,
            bot_id: bot.id,
            bot_name: bot.name,
            exchange: profile.exchange,
            symbol: bot.pair,
            side: signal,
            entry_price: entryPrice,
            contracts: contracts,
            opened_at: Math.floor(Date.now() / 1000),
            status: 'open'
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.notifyOrderFail(profile, bot, mode, signal, errorMsg);
          throw err;
        }
        break;
      }
    }
  }

  private async executeFuturesSignal(
    bot: Bot,
    profile: Profile,
    signal: string,
    mode: 'live'
  ): Promise<void> {
    const liveSide = await this.getLivePositionSide(profile.id, bot.pair);

    switch (signal) {
      case 'close':
        if (liveSide === 'flat') {
          this.logger.info(`BotRunner: skipped close for ${profile.exchange}:${bot.pair} because exchange position is already flat`);
          return;
        }
        await this.closeLiveFuturesPosition(bot, profile, mode, liveSide);
        return;

      case 'long':
      case 'short':
        if (liveSide === signal) {
          this.logger.info(`BotRunner: skipped ${signal} for ${profile.exchange}:${bot.pair} because exchange position already matches signal`);
          return;
        }

        if (liveSide !== 'flat') {
          await this.closeLiveFuturesPosition(bot, profile, mode, liveSide);
        }

        await this.openLivePosition(bot, profile, mode, signal);
        return;
    }
  }

  private async getLivePositionSide(profileId: string, pair: string): Promise<LivePositionSide> {
    const positions = await this.profileService.fetchOpenPositions(profileId);
    const position = positions.find((entry: PositionInfo) => entry.symbol === pair && Math.abs(entry.contracts) > 0);
    return position?.side ?? 'flat';
  }

  private async closeLiveFuturesPosition(
    bot: Bot,
    profile: Profile,
    mode: 'live',
    closingSide: 'long' | 'short'
  ): Promise<void> {
    try {
      const closeResult = await this.profileService.closePosition(profile.id, bot.pair, 'market');
      const exitPrice = closeResult?.price || 0;
      const contracts = Math.abs(closeResult?.amount || 0);
      const exitValue = exitPrice * contracts;
      const entryValue = bot.capital;
      const realizedPnl = closingSide === 'long' ? exitValue - entryValue : entryValue - exitValue;

      this.notifyOrderOk(profile, bot, mode, 'close', exitPrice, undefined, contracts, closeResult?.id);
      this.notifyPnl(profile, bot, mode, closingSide, undefined, exitPrice, realizedPnl, entryValue);
      this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, exitPrice, realizedPnl, 0);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.notifyOrderFail(profile, bot, mode, 'close', errorMsg);
      throw err;
    }
  }

  private async openLivePosition(
    bot: Bot,
    profile: Profile,
    mode: 'live',
    signal: 'long' | 'short'
  ): Promise<void> {
    try {
      const orderResult = await this.profileService.placeOrder(profile.id, {
        pair: bot.pair,
        side: signal === 'long' ? 'buy' : 'sell',
        type: 'market',
        amount: bot.capital,
        isQuoteCurrency: true
      });

      const entryPrice = orderResult.price || 0;
      const contracts = orderResult.amount || bot.capital / entryPrice;

      this.notifyOrderOk(profile, bot, mode, signal, entryPrice, undefined, contracts, orderResult.id);

      this.positionHistoryRepository.openPosition({
        profile_id: profile.id,
        profile_name: profile.name,
        bot_id: bot.id,
        bot_name: bot.name,
        exchange: profile.exchange,
        symbol: bot.pair,
        side: signal,
        entry_price: entryPrice,
        contracts: contracts,
        opened_at: Math.floor(Date.now() / 1000),
        status: 'open'
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.notifyOrderFail(profile, bot, mode, signal, errorMsg);
      throw err;
    }
  }

  /**
   * Execute a trade signal in PAPER mode (simulation without real orders).
   */
  private async executePaperSignal(bot: Bot, profile: Profile, signal: string, marketData: { ask: number; bid: number }): Promise<void> {
    const mode: 'paper' = 'paper';
    switch (signal) {
      case 'close': {
        // For paper, assume we close at current bid price
        const exitPrice = marketData.bid;
        const contracts = 1; // Assume 1 contract for paper
        const entryValue = bot.capital;
        const realizedPnl = (exitPrice * contracts) - entryValue;

        // Send ORDER_OK notification
        this.notifyOrderOk(profile, bot, mode, 'close', exitPrice, undefined, contracts, `paper-${Date.now()}`);

        // Send PNL notification
        this.notifyPnl(profile, bot, mode, 'long' as const, undefined, exitPrice, realizedPnl, entryValue);

        this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, exitPrice, realizedPnl, 0);
        break;
      }

      case 'long':
      case 'short': {
        // For paper, assume we enter at current ask price
        const entryPrice = marketData.ask;
        const contracts = bot.capital / entryPrice;

        // Send ORDER_OK notification
        this.notifyOrderOk(profile, bot, mode, signal, entryPrice, undefined, contracts, `paper-${Date.now()}`);

        this.positionHistoryRepository.openPosition({
          profile_id: profile.id,
          profile_name: profile.name,
          bot_id: bot.id,
          bot_name: bot.name,
          exchange: profile.exchange,
          symbol: bot.pair,
          side: signal,
          entry_price: entryPrice,
          contracts: contracts,
          opened_at: Math.floor(Date.now() / 1000),
          status: 'open'
        });
        break;
      }
    }
  }

  /**
   * Handle auto-pause triggered by adaptive risk policy.
   * This method can be called when risk assessment determines bot should be paused.
   */
  handleAutoPause(profile: Profile, bot: Bot, reason: string): void {
    if (bot.status !== 'running') {
      return;
    }

    // Send AUTO_PAUSE notification
    this.notifyAutoPause(profile, bot, reason);

    // Update bot status to stopped
    this.profileService.updateBot(profile.id, bot.id, { status: 'stopped' });

    this.logger.warn(`BotRunner: bot "${bot.name}" auto-paused: ${reason}`);
  }

  private getRunningBots(): Array<{ bot: Bot; profile: Profile }> {
    const result: Array<{ bot: Bot; profile: Profile }> = [];
    for (const profile of this.profileService.getProfiles()) {
      for (const bot of profile.bots ?? []) {
        if (bot.status === 'running') result.push({ bot, profile });
      }
    }
    return result;
  }
}
