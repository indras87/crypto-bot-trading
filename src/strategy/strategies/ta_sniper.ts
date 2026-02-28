import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition } from '../strategy';
import { AdvancedTA, type AdvancedTAResult } from '../../modules/advanced_ta';
import { Candlestick } from '../../dict/candlestick';

export interface TaSniperOptions {
  min_confidence: number;
  min_score: number;
  min_volume_confirm: number;
  min_adx: number;
  rsi_min: number;
  rsi_max: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  trailing_stop_pct: number;
  max_trades_per_day: number;
  require_divergence_check: boolean;
  allow_squeeze_entry: boolean;
  timeframe: string;
  timeframe_mode: 'strict' | 'auto';
  timeframe_overrides?: Record<string, Partial<TaSniperThresholdConfig>>;
  advanced_ta_refresh_candles: number;
  advanced_ta_warmup_candles: number;
  advanced_ta_cache_enabled: boolean;
  advanced_ta_refresh_candles_by_timeframe?: Record<string, number>;
  advanced_ta_warmup_candles_by_timeframe?: Record<string, number>;
}

type TaSniperThresholdConfig = Pick<
  TaSniperOptions,
  'min_confidence' | 'min_score' | 'min_volume_confirm' | 'min_adx' | 'rsi_min' | 'rsi_max' | 'require_divergence_check' | 'allow_squeeze_entry'
>;

const TA_SNIPER_TIMEFRAME_PROFILES: Record<string, TaSniperThresholdConfig> = {
  '1m': { min_confidence: 0.55, min_score: 2.0, min_volume_confirm: 0.45, min_adx: 14, rsi_min: 20, rsi_max: 80, require_divergence_check: false, allow_squeeze_entry: true },
  '3m': { min_confidence: 0.58, min_score: 2.3, min_volume_confirm: 0.5, min_adx: 16, rsi_min: 22, rsi_max: 78, require_divergence_check: false, allow_squeeze_entry: true },
  '5m': { min_confidence: 0.62, min_score: 2.6, min_volume_confirm: 0.55, min_adx: 18, rsi_min: 25, rsi_max: 75, require_divergence_check: false, allow_squeeze_entry: true },
  '15m': { min_confidence: 0.65, min_score: 2.9, min_volume_confirm: 0.6, min_adx: 20, rsi_min: 26, rsi_max: 74, require_divergence_check: false, allow_squeeze_entry: false },
  '30m': { min_confidence: 0.68, min_score: 3.1, min_volume_confirm: 0.62, min_adx: 22, rsi_min: 28, rsi_max: 72, require_divergence_check: true, allow_squeeze_entry: false },
  '1h': { min_confidence: 0.7, min_score: 3.3, min_volume_confirm: 0.65, min_adx: 24, rsi_min: 30, rsi_max: 70, require_divergence_check: true, allow_squeeze_entry: false },
  '4h': { min_confidence: 0.72, min_score: 3.5, min_volume_confirm: 0.68, min_adx: 25, rsi_min: 30, rsi_max: 70, require_divergence_check: true, allow_squeeze_entry: false },
  '1d': { min_confidence: 0.75, min_score: 3.8, min_volume_confirm: 0.7, min_adx: 27, rsi_min: 32, rsi_max: 68, require_divergence_check: true, allow_squeeze_entry: false }
};

const TA_SNIPER_ADVANCED_TA_REFRESH_BY_TIMEFRAME: Record<string, number> = {
  '1m': 6,
  '3m': 4,
  '5m': 3,
  '15m': 3,
  '30m': 2,
  '1h': 2,
  '4h': 1,
  '1d': 1
};

const TA_SNIPER_ADVANCED_TA_WARMUP_BY_TIMEFRAME: Record<string, number> = {
  '1m': 180,
  '3m': 140,
  '5m': 120,
  '15m': 120,
  '30m': 110,
  '1h': 100,
  '4h': 100,
  '1d': 100
};

export type TaSniperIndicators = {
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd'>;
  bb: TypedIndicatorDefinition<'bb'>;
  ema50: TypedIndicatorDefinition<'ema'>;
  ema200: TypedIndicatorDefinition<'ema'>;
  adx: TypedIndicatorDefinition<'adx'>;
  sar: TypedIndicatorDefinition<'psar'>;
  mfi: TypedIndicatorDefinition<'mfi'>;
  cci: TypedIndicatorDefinition<'cci'>;
  ao: TypedIndicatorDefinition<'ao'>;
  atr: TypedIndicatorDefinition<'atr'>;
  candles: TypedIndicatorDefinition<'candles'>;
};

export class TaSniper extends StrategyBase<TaSniperIndicators, TaSniperOptions> {
  private advancedTa: AdvancedTA;
  private entryPrice?: number;
  private tradeCountToday: number = 0;
  private lastTradeDate: string = '';
  private peakPrice?: number;
  private troughPrice?: number;
  private cachedAdvancedAnalysis?: AdvancedTAResult;
  private cachedAdvancedAnalysisAt: number = -1;
  private advancedTaCalls: number = 0;
  private advancedTaCacheHits: number = 0;
  private advancedTaTotalMs: number = 0;

  constructor(partialOptions?: Partial<TaSniperOptions>) {
    super(partialOptions);
    this.advancedTa = new AdvancedTA();
  }

  getDescription(): string {
    return 'TA Sniper - High-precision scalping strategy with multi-indicator confirmation, divergence detection, and tight stop loss';
  }

  defineIndicators(): TaSniperIndicators {
    return {
      rsi: strategy.indicator.rsi({ length: 14 }),
      macd: strategy.indicator.macd({ fast_length: 12, slow_length: 26, signal_length: 9 }),
      bb: strategy.indicator.bb({ length: 20, stddev: 2 }),
      ema50: strategy.indicator.ema({ length: 50 }),
      ema200: strategy.indicator.ema({ length: 200 }),
      adx: strategy.indicator.adx({ length: 14 }),
      sar: strategy.indicator.psar({ step: 0.02, max: 0.2 }),
      mfi: strategy.indicator.mfi({ length: 14 }),
      cci: strategy.indicator.cci({ length: 20 }),
      ao: strategy.indicator.ao({}),
      atr: strategy.indicator.atr({ length: 14 }),
      candles: strategy.indicator.candles({})
    };
  }

  private getTradingDayKey(candleTime: number): string {
    return new Date(candleTime * 1000).toISOString().slice(0, 10);
  }

  private checkDailyLimit(candleTime: number, maxTradesPerDay: number): boolean {
    const dayKey = this.getTradingDayKey(candleTime);
    if (this.lastTradeDate !== dayKey) {
      this.tradeCountToday = 0;
      this.lastTradeDate = dayKey;
    }
    return this.tradeCountToday < maxTradesPerDay;
  }

  private getEffectiveThresholds(timeframe: string): TaSniperThresholdConfig {
    const strictBase: TaSniperThresholdConfig = {
      min_confidence: this.options.min_confidence,
      min_score: this.options.min_score,
      min_volume_confirm: this.options.min_volume_confirm,
      min_adx: this.options.min_adx,
      rsi_min: this.options.rsi_min,
      rsi_max: this.options.rsi_max,
      require_divergence_check: this.options.require_divergence_check,
      allow_squeeze_entry: this.options.allow_squeeze_entry
    };

    if (this.options.timeframe_mode === 'strict') {
      return strictBase;
    }

    const profile = TA_SNIPER_TIMEFRAME_PROFILES[timeframe] || TA_SNIPER_TIMEFRAME_PROFILES[this.options.timeframe] || strictBase;
    const override = this.options.timeframe_overrides?.[timeframe] || {};

    return {
      ...strictBase,
      ...profile,
      ...override
    };
  }

  private getAdvancedTaRuntimeSettings(timeframe: string): { refreshEvery: number; warmupCandles: number } {
    const refreshByTf =
      this.options.advanced_ta_refresh_candles_by_timeframe?.[timeframe] ??
      TA_SNIPER_ADVANCED_TA_REFRESH_BY_TIMEFRAME[timeframe] ??
      this.options.advanced_ta_refresh_candles;
    const warmupByTf =
      this.options.advanced_ta_warmup_candles_by_timeframe?.[timeframe] ??
      TA_SNIPER_ADVANCED_TA_WARMUP_BY_TIMEFRAME[timeframe] ??
      this.options.advanced_ta_warmup_candles;

    return {
      refreshEvery: Math.max(refreshByTf || 3, 1),
      warmupCandles: Math.max(warmupByTf || 120, 100)
    };
  }

  private async getAdvancedAnalysis(candles: Candlestick[], timeframe: string): Promise<AdvancedTAResult | null> {
    const { refreshEvery, warmupCandles } = this.getAdvancedTaRuntimeSettings(timeframe);
    const cacheEnabled = this.options.advanced_ta_cache_enabled !== false;
    const currentIndex = candles.length - 1;

    if (candles.length < warmupCandles) {
      return null;
    }

    if (cacheEnabled && this.cachedAdvancedAnalysis && this.cachedAdvancedAnalysisAt >= 0 && currentIndex - this.cachedAdvancedAnalysisAt < refreshEvery) {
      this.advancedTaCacheHits++;
      return this.cachedAdvancedAnalysis;
    }

    const startedAt = Date.now();
    try {
      const analysis = await this.advancedTa.analyze(candles);
      this.advancedTaCalls++;
      this.advancedTaTotalMs += Date.now() - startedAt;

      if (cacheEnabled) {
        this.cachedAdvancedAnalysis = analysis;
        this.cachedAdvancedAnalysisAt = currentIndex;
      }

      return analysis;
    } catch (e) {
      console.log(`TaSniper: Advanced TA analysis failed: ${String(e)}`);
      return null;
    }
  }

  private getTailValue<T>(arr: T[] | undefined, backFromLast: number = 0): T | undefined {
    if (!arr || arr.length === 0) return undefined;
    const idx = arr.length - 1 - backFromLast;
    if (idx < 0) return undefined;
    return arr[idx];
  }

  async execute(context: TypedStrategyContext<TaSniperIndicators>, signal: StrategySignal): Promise<void> {
    const prices = context.prices;
    const lastSignal = context.lastSignal;
    const candles = context.getIndicator('candles') as unknown as Candlestick[];

    if (!candles || candles.length < 100 || prices.length < 2) {
      return;
    }

    const rsiSeries = context.getIndicator('rsi') as unknown as Array<number | null>;
    const macdSeries = context.getIndicator('macd') as unknown as Array<{ macd: number; signal: number; histogram: number } | null>;
    const adxSeries = context.getIndicator('adx') as unknown as Array<number | null>;
    const ema50Series = context.getIndicator('ema50') as unknown as Array<number | null>;
    const ema200Series = context.getIndicator('ema200') as unknown as Array<number | null>;
    const sarSeries = context.getIndicator('sar') as unknown as Array<number | null>;

    const currentRsi = this.getTailValue(rsiSeries, 0);
    const currentMacd = this.getTailValue(macdSeries, 0);
    const prevMacd = this.getTailValue(macdSeries, 1);
    const currentAdx = this.getTailValue(adxSeries, 0);
    const currentEma50 = this.getTailValue(ema50Series, 0);
    const currentEma200 = this.getTailValue(ema200Series, 0);
    const currentSar = this.getTailValue(sarSeries, 0);
    const prevSar = this.getTailValue(sarSeries, 1);

    const currentPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];

    if (
      typeof currentRsi !== 'number' ||
      typeof currentAdx !== 'number' ||
      !currentMacd ||
      !prevMacd ||
      typeof currentEma50 !== 'number' ||
      typeof currentEma200 !== 'number' ||
      typeof currentSar !== 'number' ||
      typeof prevSar !== 'number'
    ) {
      return;
    }

    const timeframe = this.options.timeframe || '5m';
    const thresholds = this.getEffectiveThresholds(timeframe);
    const currentCandle = candles[candles.length - 1];

    const macdCrossUp = currentMacd.histogram > 0 && prevMacd.histogram <= 0;
    const macdCrossDown = currentMacd.histogram < 0 && prevMacd.histogram >= 0;
    const sarFlipUp = currentSar > currentPrice && prevSar <= prevPrice;
    const sarFlipDown = currentSar < currentPrice && prevSar >= prevPrice;

    const longExit = (lastSignal === 'long' && sarFlipDown) || (lastSignal === 'long' && this.exitByProfit(currentPrice));
    const shortExit = (lastSignal === 'short' && sarFlipUp) || (lastSignal === 'short' && this.exitByProfit(currentPrice));
    const emergencyExit = lastSignal && (currentRsi > 85 || currentRsi < 15);
    const hardStopLoss = lastSignal && this.checkHardStopLoss(currentPrice);

    if (longExit || shortExit || emergencyExit || hardStopLoss) {
      let exitReason = '';
      if (longExit || shortExit) exitReason = 'TRAILING/SAR';
      else if (emergencyExit) exitReason = 'RSI_EXTREME';
      else exitReason = 'HARD_SL';

      signal.debugAll({
        exit: true,
        reason: exitReason,
        rsi: Math.round(currentRsi * 100) / 100,
        profit: lastSignal ? this.calculateProfit(currentPrice) : 0
      });

      signal.close();
      this.entryPrice = undefined;
      this.peakPrice = undefined;
      this.troughPrice = undefined;
      return;
    }

    if (!lastSignal) {
      this.entryPrice = undefined;
      this.peakPrice = undefined;
      this.troughPrice = undefined;

      if (!this.checkDailyLimit(currentCandle.time, this.options.max_trades_per_day!)) {
        signal.debugAll({ message: 'Daily limit reached' });
        return;
      }

      const weakTrend = currentAdx < thresholds.min_adx * 0.7;
      const weakMomentum = Math.abs(currentMacd.histogram) < 0.0001;
      const farOutsideRsi = currentRsi < thresholds.rsi_min - 8 || currentRsi > thresholds.rsi_max + 8;

      // Fast-path for low-probability candles to avoid expensive AdvancedTA calls.
      if ((weakTrend && weakMomentum) || (farOutsideRsi && weakTrend)) {
        return;
      }

      const advancedAnalysis = await this.getAdvancedAnalysis(candles, timeframe);
      if (!advancedAnalysis) {
        return;
      }

      const score = advancedAnalysis.score;
      const divergences = advancedAnalysis.divergences;
      const squeeze = advancedAnalysis.squeeze;

      const hasLongConditions =
        (advancedAnalysis.signal.signal === 'long' || advancedAnalysis.signal.signal7Tier === 'BUY') &&
        (score?.confidence ?? 0) >= thresholds.min_confidence &&
        (score?.normalizedScore ?? 0) >= thresholds.min_score / 10 &&
        (score?.volumeConfirmation ?? 0) >= thresholds.min_volume_confirm &&
        currentAdx >= thresholds.min_adx &&
        currentRsi >= thresholds.rsi_min &&
        currentRsi <= thresholds.rsi_max &&
        (!thresholds.require_divergence_check || (divergences?.rsi !== 'BEARISH_DIV' && divergences?.macd !== 'BEARISH_DIV')) &&
        (!thresholds.allow_squeeze_entry || !squeeze);

      const hasShortConditions =
        (advancedAnalysis.signal.signal === 'short' || advancedAnalysis.signal.signal7Tier === 'SELL') &&
        (score?.confidence ?? 0) >= thresholds.min_confidence &&
        (score?.normalizedScore ?? 0) <= -thresholds.min_score / 10 &&
        (score?.volumeConfirmation ?? 0) >= thresholds.min_volume_confirm &&
        currentAdx >= thresholds.min_adx &&
        currentRsi >= thresholds.rsi_min &&
        currentRsi <= thresholds.rsi_max &&
        (!thresholds.require_divergence_check || (divergences?.rsi !== 'BULLISH_DIV' && divergences?.macd !== 'BULLISH_DIV')) &&
        (!thresholds.allow_squeeze_entry || !squeeze);

      if (hasLongConditions && (macdCrossUp || currentMacd.histogram > 0)) {
        this.entryPrice = currentPrice;
        this.peakPrice = currentPrice;
        this.troughPrice = currentPrice;
        this.tradeCountToday++;

        signal.debugAll({
          signal: 'LONG',
          triggered: true,
          score: score?.scoreTotal ?? 0,
          confidence: score?.confidence ?? 0,
          rsi: Math.round(currentRsi * 100) / 100,
          adx: Math.round(currentAdx * 100) / 100,
          divergence: divergences?.rsi ?? 'NONE',
          squeeze: squeeze ?? false,
          ema_trend: currentEma50 > currentEma200 ? 'BULLISH' : 'BEARISH',
          advanced_ta_calls: this.advancedTaCalls,
          advanced_ta_cache_hits: this.advancedTaCacheHits,
          advanced_ta_avg_ms: this.advancedTaCalls > 0 ? Math.round(this.advancedTaTotalMs / this.advancedTaCalls) : 0
        });

        signal.goLong();
        return;
      }

      if (hasShortConditions && (macdCrossDown || currentMacd.histogram < 0)) {
        this.entryPrice = currentPrice;
        this.peakPrice = currentPrice;
        this.troughPrice = currentPrice;
        this.tradeCountToday++;

        signal.debugAll({
          signal: 'SHORT',
          triggered: true,
          score: score?.scoreTotal ?? 0,
          confidence: score?.confidence ?? 0,
          rsi: Math.round(currentRsi * 100) / 100,
          adx: Math.round(currentAdx * 100) / 100,
          divergence: divergences?.rsi ?? 'NONE',
          squeeze: squeeze ?? false,
          ema_trend: currentEma50 < currentEma200 ? 'BEARISH' : 'BULLISH',
          advanced_ta_calls: this.advancedTaCalls,
          advanced_ta_cache_hits: this.advancedTaCacheHits,
          advanced_ta_avg_ms: this.advancedTaCalls > 0 ? Math.round(this.advancedTaTotalMs / this.advancedTaCalls) : 0
        });

        signal.goShort();
        return;
      }

      if (advancedAnalysis.signal.trigger) {
        const blockedBy: string[] = [];
        const triggerSignal = advancedAnalysis.signal.signal;

        if ((score?.confidence ?? 0) < thresholds.min_confidence) blockedBy.push('confidence');
        if ((score?.volumeConfirmation ?? 0) < thresholds.min_volume_confirm) blockedBy.push('volume_confirm');
        if (currentAdx < thresholds.min_adx) blockedBy.push('adx');
        if (currentRsi < thresholds.rsi_min || currentRsi > thresholds.rsi_max) blockedBy.push('rsi_range');
        if (triggerSignal === 'long' && !(macdCrossUp || currentMacd.histogram > 0)) blockedBy.push('macd_confirm');
        if (triggerSignal === 'short' && !(macdCrossDown || currentMacd.histogram < 0)) blockedBy.push('macd_confirm');

        if (
          thresholds.require_divergence_check &&
          ((triggerSignal === 'long' && (divergences?.rsi === 'BEARISH_DIV' || divergences?.macd === 'BEARISH_DIV')) ||
            (triggerSignal === 'short' && (divergences?.rsi === 'BULLISH_DIV' || divergences?.macd === 'BULLISH_DIV')))
        ) {
          blockedBy.push('divergence');
        }

        if (!thresholds.allow_squeeze_entry && squeeze) blockedBy.push('squeeze');

        signal.debugAll({
          gate: 'blocked',
          blocked_by: blockedBy,
          timeframe,
          score: score?.scoreTotal ?? 0,
          normalized_score: score?.normalizedScore ?? 0,
          confidence: score?.confidence ?? 0,
          volume_confirm: score?.volumeConfirmation ?? 0,
          adx: Math.round(currentAdx * 100) / 100,
          rsi: Math.round(currentRsi * 100) / 100,
          thresholds,
          advanced_ta_calls: this.advancedTaCalls,
          advanced_ta_cache_hits: this.advancedTaCacheHits,
          advanced_ta_avg_ms: this.advancedTaCalls > 0 ? Math.round(this.advancedTaTotalMs / this.advancedTaCalls) : 0
        });
      }
    }

    if (lastSignal === 'long') {
      this.peakPrice = Math.max(this.peakPrice ?? currentPrice, currentPrice);
      this.troughPrice = Math.min(this.troughPrice ?? currentPrice, currentPrice);
    } else if (lastSignal === 'short') {
      this.peakPrice = Math.max(this.peakPrice ?? currentPrice, currentPrice);
      this.troughPrice = Math.min(this.troughPrice ?? currentPrice, currentPrice);
    }
  }

  private calculateProfit(currentPrice: number): number {
    if (!this.entryPrice) return 0;
    return ((currentPrice - this.entryPrice) / this.entryPrice) * 100;
  }

  private exitByProfit(currentPrice: number): boolean {
    if (!this.entryPrice) return false;
    const profit = this.calculateProfit(currentPrice);

    if (profit >= this.options.take_profit_pct!) {
      return true;
    }

    if (this.peakPrice !== undefined) {
      const drawdownFromPeak = ((this.peakPrice - currentPrice) / this.peakPrice) * 100;
      if (drawdownFromPeak >= this.options.trailing_stop_pct!) {
        return true;
      }
    }

    return false;
  }

  private checkHardStopLoss(currentPrice: number): boolean {
    if (!this.entryPrice) return false;
    const profit = this.calculateProfit(currentPrice);
    return profit <= -this.options.stop_loss_pct!;
  }

  protected getDefaultOptions(): TaSniperOptions {
    return {
      min_confidence: 0.7,
      min_score: 3.5,
      min_volume_confirm: 0.7,
      min_adx: 25,
      rsi_min: 30,
      rsi_max: 70,
      stop_loss_pct: 1.0,
      take_profit_pct: 1.5,
      trailing_stop_pct: 1.0,
      max_trades_per_day: 4,
      require_divergence_check: true,
      allow_squeeze_entry: false,
      timeframe: '5m',
      timeframe_mode: 'auto',
      timeframe_overrides: {},
      advanced_ta_refresh_candles: 3,
      advanced_ta_warmup_candles: 120,
      advanced_ta_cache_enabled: true,
      advanced_ta_refresh_candles_by_timeframe: {},
      advanced_ta_warmup_candles_by_timeframe: {}
    };
  }
}

export default TaSniper;
