import { Notify } from '../notify/notify';
import { Logger } from '../modules/services';
import { SignalRepository, PositionHistoryRepository } from '../repository';
import { ProfileService } from '../profile/profile_service';
import { StrategyExecutor } from '../modules/strategy/v2/typed_backtest';
import type { BotV2, Profile, PositionInfo } from '../profile/types';
import { AdaptivePolicyService } from '../ai/adaptive_policy_service';

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
      throw new Error(`BotRunnerV2: unsupported period unit "${unit}" in "${period}"`);
  }
}

function isFuturesPair(pair: string): boolean {
  return pair.includes(':');
}

type LivePositionSide = 'flat' | 'long' | 'short';

export class BotRunnerV2 {
  private started = false;
  private paperPositions = new Map<string, { side: 'long' | 'short'; entryPrice: number; contracts: number }>();

  constructor(
    private readonly profileService: ProfileService,
    private readonly strategyExecutor: StrategyExecutor,
    private readonly notifier: Notify,
    private readonly signalRepository: SignalRepository,
    private readonly positionHistoryRepository: PositionHistoryRepository,
    private readonly adaptivePolicyService: AdaptivePolicyService,
    private readonly logger: Logger
  ) {}

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

    this.logger.info(`BotRunnerV2: first tick in ${(delay / 1000).toFixed(1)}s`);
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
        this.logger.warn(`BotRunnerV2: bot "${bot.name}" has unsupported interval "${bot.interval}", skipping`);
        continue;
      }

      if (minutesSinceEpoch % periodMin !== 0) continue;
      this.logger.info(`BotRunnerV2: triggering "${bot.name}" (${bot.strategy} ${profile.exchange}:${bot.pair} ${bot.interval})`);

      try {
        await this.runBot(bot, profile);
      } catch (err) {
        this.logger.error(`BotRunnerV2: bot "${bot.name}" (${bot.strategy} ${profile.exchange}:${bot.pair}) failed: ${err}`);
      }
    }
  }

  private async runBot(bot: BotV2, profile: Profile): Promise<void> {
    this.adaptivePolicyService.ensureInitialPolicy(profile.id, bot);

    if (this.adaptivePolicyService.isPaused(profile.id, bot.id)) {
      this.logger.warn(`BotRunnerV2: skipped "${bot.name}" because risk state is paused`);
      return;
    }

    const cfg = this.adaptivePolicyService.getEffectiveConfig(bot);
    const marketData = await this.profileService.fetchTicker(profile.id, bot.pair);
    const signal = await this.strategyExecutor.executeStrategy(bot.strategy, profile.exchange, bot.pair, bot.interval, bot.options ?? {}, {
      useAiValidator: bot.useAiValidator ?? true
    });

    if (!signal) return;
    if (cfg.futuresOnlyLongShort && (signal === 'long' || signal === 'short') && !isFuturesPair(bot.pair)) {
      return;
    }

    if (cfg.executionMode === 'live') {
      const gate = this.adaptivePolicyService.getLiveGateStatus(profile.id, bot);
      if (!gate.eligible) {
        this.logger.warn(`BotRunnerV2: live gate blocked "${bot.name}": ${gate.reason}`);
        return;
      }
    }

    this.signalRepository.insertSignal(
      profile.exchange,
      bot.pair,
      { price: marketData.ask, strategy: `${bot.strategy}_v2`, interval: bot.interval },
      signal,
      `${bot.strategy}_v2`,
      bot.interval
    );

    this.notifier.send(`[V2 ${signal} (${bot.strategy})] ${profile.exchange}:${bot.pair} @ ${marketData.ask}`);
    await this.executeSignal(bot, profile, signal, marketData.ask, cfg.executionMode);
  }

  private async executeSignal(
    bot: BotV2,
    profile: Profile,
    signal: string,
    marketPrice: number,
    executionMode: 'paper' | 'live'
  ): Promise<void> {
    if (executionMode === 'paper') {
      await this.executePaperSignal(bot, profile, signal, marketPrice);
      return;
    }

    if (isFuturesPair(bot.pair)) {
      await this.executeLiveFuturesSignal(bot, profile, signal, marketPrice);
      return;
    }

    if (signal === 'close') {
      const openPosition = this.positionHistoryRepository
        .getOpenPositions(profile.id)
        .find(p => p.bot_id === bot.id && p.symbol === bot.pair);
      if (!openPosition) return;

      const closeResult = await this.profileService.closePosition(profile.id, bot.pair, 'market');
      const exitPrice = closeResult?.price || marketPrice;
      const contracts = Math.abs(closeResult?.amount || openPosition.contracts || 0);
      const entryPrice = Number(openPosition.entry_price || 0);
      const side = (openPosition.side || 'long') as 'long' | 'short';
      const realizedPnl = side === 'long' ? (exitPrice - entryPrice) * contracts : (entryPrice - exitPrice) * contracts;

      this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, exitPrice, realizedPnl, 0);
      const risk = this.adaptivePolicyService.recordClosedTrade(profile.id, bot, { realizedPnl });
      this.applyAutoPause(profile, bot, risk?.pause_reason);
      return;
    }

    if (signal !== 'long' && signal !== 'short') return;

    const orderResult = await this.profileService.placeOrder(profile.id, {
      pair: bot.pair,
      side: signal === 'long' ? 'buy' : 'sell',
      type: 'market',
      amount: bot.capital,
      isQuoteCurrency: true
    });

    const entryPrice = orderResult.price || marketPrice;
    this.positionHistoryRepository.openPosition({
      profile_id: profile.id,
      profile_name: profile.name,
      bot_id: bot.id,
      bot_name: bot.name,
      exchange: profile.exchange,
      symbol: bot.pair,
      side: signal,
      entry_price: entryPrice,
      contracts: orderResult.amount || bot.capital / Math.max(entryPrice, 1e-9),
      opened_at: Math.floor(Date.now() / 1000),
      status: 'open'
    });
  }

  private async executeLiveFuturesSignal(
    bot: BotV2,
    profile: Profile,
    signal: string,
    marketPrice: number
  ): Promise<void> {
    const livePosition = await this.getLivePosition(profile.id, bot.pair);
    const liveSide = livePosition?.side ?? 'flat';

    if (signal === 'close') {
      if (liveSide === 'flat') {
        this.logger.info(`BotRunnerV2: skipped close for ${profile.exchange}:${bot.pair} because exchange position is already flat`);
        return;
      }

      await this.closeLiveFuturesPosition(bot, profile, marketPrice, livePosition!);
      return;
    }

    if (signal !== 'long' && signal !== 'short') return;

    if (liveSide === signal) {
      this.logger.info(`BotRunnerV2: skipped ${signal} for ${profile.exchange}:${bot.pair} because exchange position already matches signal`);
      return;
    }

    if (liveSide !== 'flat') {
      const closeOutcome = await this.closeLiveFuturesPosition(bot, profile, marketPrice, livePosition!);
      if (closeOutcome.paused) {
        return;
      }
    }

    await this.openLivePosition(bot, profile, signal, marketPrice);
  }

  private async getLivePosition(profileId: string, pair: string): Promise<PositionInfo | undefined> {
    const positions = await this.profileService.fetchOpenPositions(profileId);
    return positions.find(position => position.symbol === pair && Math.abs(position.contracts) > 0);
  }

  private async closeLiveFuturesPosition(
    bot: BotV2,
    profile: Profile,
    marketPrice: number,
    livePosition: PositionInfo
  ): Promise<{ paused: boolean }> {
    const closeResult = await this.profileService.closePosition(profile.id, bot.pair, 'market');
    const exitPrice = closeResult?.price || marketPrice;
    const contracts = Math.abs(closeResult?.amount || livePosition.contracts || 0);

    const openPosition = this.positionHistoryRepository
      .getOpenPositions(profile.id)
      .find(p => p.bot_id === bot.id && p.symbol === bot.pair);
    const side = (livePosition.side || openPosition?.side || 'long') as 'long' | 'short';
    const entryPrice = Number(livePosition.entryPrice || openPosition?.entry_price || exitPrice);
    const realizedPnl = side === 'long' ? (exitPrice - entryPrice) * contracts : (entryPrice - exitPrice) * contracts;

    this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, exitPrice, realizedPnl, 0);
    const risk = this.adaptivePolicyService.recordClosedTrade(profile.id, bot, { realizedPnl });
    this.applyAutoPause(profile, bot, risk?.pause_reason);
    return { paused: Boolean(risk?.pause_reason) };
  }

  private async openLivePosition(
    bot: BotV2,
    profile: Profile,
    signal: 'long' | 'short',
    marketPrice: number
  ): Promise<void> {
    const orderResult = await this.profileService.placeOrder(profile.id, {
      pair: bot.pair,
      side: signal === 'long' ? 'buy' : 'sell',
      type: 'market',
      amount: bot.capital,
      isQuoteCurrency: true
    });

    const entryPrice = orderResult.price || marketPrice;
    this.positionHistoryRepository.openPosition({
      profile_id: profile.id,
      profile_name: profile.name,
      bot_id: bot.id,
      bot_name: bot.name,
      exchange: profile.exchange,
      symbol: bot.pair,
      side: signal,
      entry_price: entryPrice,
      contracts: orderResult.amount || bot.capital / Math.max(entryPrice, 1e-9),
      opened_at: Math.floor(Date.now() / 1000),
      status: 'open'
    });
  }

  private async executePaperSignal(bot: BotV2, profile: Profile, signal: string, marketPrice: number): Promise<void> {
    const key = `${profile.id}:${bot.id}:${bot.pair}`;
    const existing = this.paperPositions.get(key);

    if (signal === 'close') {
      if (!existing) return;

      const realizedPnl =
        existing.side === 'long'
          ? (marketPrice - existing.entryPrice) * existing.contracts
          : (existing.entryPrice - marketPrice) * existing.contracts;
      this.positionHistoryRepository.closePosition(profile.id, bot.id, bot.pair, marketPrice, realizedPnl, 0);
      this.paperPositions.delete(key);

      const risk = this.adaptivePolicyService.recordClosedTrade(profile.id, bot, { realizedPnl });
      this.applyAutoPause(profile, bot, risk?.pause_reason);
      return;
    }

    if (signal !== 'long' && signal !== 'short') return;
    if (existing) return;

    const contracts = bot.capital / Math.max(marketPrice, 1e-9);
    this.paperPositions.set(key, { side: signal, entryPrice: marketPrice, contracts });

    this.positionHistoryRepository.openPosition({
      profile_id: profile.id,
      profile_name: profile.name,
      bot_id: bot.id,
      bot_name: bot.name,
      exchange: profile.exchange,
      symbol: bot.pair,
      side: signal,
      entry_price: marketPrice,
      contracts,
      opened_at: Math.floor(Date.now() / 1000),
      status: 'open'
    });
  }

  private applyAutoPause(profile: Profile, bot: BotV2, reason?: string): void {
    if (!reason) return;
    if (bot.status !== 'running') return;
    this.profileService.updateBotV2(profile.id, bot.id, { status: 'stopped' });
    this.logger.warn(`BotRunnerV2: auto-paused bot "${bot.name}" due to risk: ${reason}`);
  }

  private getRunningBots(): Array<{ bot: BotV2; profile: Profile }> {
    const result: Array<{ bot: BotV2; profile: Profile }> = [];
    for (const profile of this.profileService.getProfiles()) {
      for (const bot of profile.botsV2 ?? []) {
        if (bot.status === 'running') result.push({ bot, profile });
      }
    }
    return result;
  }
}
