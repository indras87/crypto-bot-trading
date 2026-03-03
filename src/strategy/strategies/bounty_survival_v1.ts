import strategy, { StrategyBase, StrategySignal, TypedStrategyContext, type MacdResult, type TypedIndicatorDefinition } from '../strategy';
import { Candlestick } from '../../dict/candlestick';

export interface BountySurvivalV1Options {
  timeframe: string;
  ema_fast: number;
  ema_slow: number;
  adx_length: number;
  adx_min: number;
  rsi_length: number;
  rsi_long_min: number;
  rsi_long_max: number;
  rsi_short_min: number;
  rsi_short_max: number;
  macd_fast: number;
  macd_slow: number;
  macd_signal: number;
  atr_length: number;
  atr_ratio_min: number;
  atr_ratio_max: number;
  obv_lookback: number;
  cooldown_candles: number;
  max_trades_per_day: number;
  min_signal_score: number;
  trend_buffer_pct: number;
  require_price_above_ema_fast: boolean;
  ema_fast_slope_lookback: number;
  min_ema_fast_slope_pct: number;
  require_breakout: boolean;
  breakout_lookback: number;
  require_rsi_rising: boolean;
  macd_hist_min: number;
  hold_max_candles: number;
  rsi_long_exit_max: number;
  rsi_short_exit_min: number;
  allow_long: boolean;
  allow_short: boolean;
  pair_symbol?: string;
  pair_exchange?: string;
  pair_overrides?: Record<string, Partial<BountySurvivalV1Options>>;
}

type BountySurvivalV1Indicators = {
  emaFast: TypedIndicatorDefinition<'ema'>;
  emaSlow: TypedIndicatorDefinition<'ema'>;
  adx: TypedIndicatorDefinition<'adx'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd'>;
  atr: TypedIndicatorDefinition<'atr'>;
  obv: TypedIndicatorDefinition<'obv'>;
  candles: TypedIndicatorDefinition<'candles'>;
};

type Regime = 'bull' | 'bear' | 'neutral';

export class BountySurvivalV1 extends StrategyBase<BountySurvivalV1Indicators, BountySurvivalV1Options> {
  private tradeCountToday = 0;
  private lastTradeDate = '';
  private cooldownRemaining = 0;
  private positionBars = 0;

  getDescription(): string {
    return 'Ultra-conservative adaptive regime strategy for small-capital futures survival';
  }

  defineIndicators(): BountySurvivalV1Indicators {
    return {
      emaFast: strategy.indicator.ema({ length: this.options.ema_fast }),
      emaSlow: strategy.indicator.ema({ length: this.options.ema_slow }),
      adx: strategy.indicator.adx({ length: this.options.adx_length }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length }),
      macd: strategy.indicator.macd({
        fast_length: this.options.macd_fast,
        slow_length: this.options.macd_slow,
        signal_length: this.options.macd_signal
      }),
      atr: strategy.indicator.atr({ length: this.options.atr_length }),
      obv: strategy.indicator.obv({}),
      candles: strategy.indicator.candles({})
    };
  }

  async execute(context: TypedStrategyContext<BountySurvivalV1Indicators>, signal: StrategySignal): Promise<void> {
    const opts = this.getEffectiveOptions();
    const prices = context.prices;
    const candles = context.getIndicator('candles') as unknown as Candlestick[];
    if (!candles || candles.length < 240 || prices.length < 3) {
      return;
    }

    const currentCandle = candles[candles.length - 1];
    this.rollDailyCounter(currentCandle.time);
    this.updatePositionBars(context.lastSignal);

    const emaFastSeries = context.getIndicator('emaFast') as Array<number | null>;
    const emaSlowSeries = context.getIndicator('emaSlow') as Array<number | null>;
    const adxSeries = context.getIndicator('adx') as Array<number | null>;
    const rsiSeries = context.getIndicator('rsi') as Array<number | null>;
    const atrSeries = context.getIndicator('atr') as Array<number | null>;
    const obvSeries = context.getIndicator('obv') as Array<number | null>;
    const macdSeries = context.getIndicator('macd') as Array<MacdResult | null>;

    const emaFast = this.lastNumber(emaFastSeries);
    const emaSlow = this.lastNumber(emaSlowSeries);
    const adx = this.lastNumber(adxSeries);
    const rsi = this.lastNumber(rsiSeries);
    const rsiPrev = this.lastNumberAt(rsiSeries, 1);
    const atr = this.lastNumber(atrSeries);
    const emaFastPrevSlope = this.lastNumberAt(emaFastSeries, opts.ema_fast_slope_lookback);
    const macdCurrent = this.lastMacd(macdSeries, 0);
    const macdPrev = this.lastMacd(macdSeries, 1);

    if (
      emaFast === null ||
      emaSlow === null ||
      adx === null ||
      rsi === null ||
      rsiPrev === null ||
      atr === null ||
      emaFastPrevSlope === null ||
      macdCurrent === null ||
      macdPrev === null
    ) {
      return;
    }

    const price = prices[prices.length - 1];
    const regime = this.detectRegime(price, emaFast, emaSlow);
    const atrRatio = atr / Math.max(price, 1e-8);
    const trendDistance = Math.abs(price - emaSlow) / Math.max(price, 1e-8);
    const emaFastSlopePct = (emaFast - emaFastPrevSlope) / Math.max(Math.abs(emaFastPrevSlope), 1e-8);

    const adxOk = adx >= opts.adx_min;
    const atrOk = atrRatio >= opts.atr_ratio_min && atrRatio <= opts.atr_ratio_max;
    const trendBufferOkLong = price > emaSlow && trendDistance >= opts.trend_buffer_pct;
    const trendBufferOkShort = price < emaSlow && trendDistance >= opts.trend_buffer_pct;
    const emaSlopeLongOk = emaFastSlopePct >= opts.min_ema_fast_slope_pct;
    const emaSlopeShortOk = emaFastSlopePct <= -opts.min_ema_fast_slope_pct;
    const priceVsEmaFastLongOk = !opts.require_price_above_ema_fast || price > emaFast;
    const priceVsEmaFastShortOk = !opts.require_price_above_ema_fast || price < emaFast;

    const obvBullish = this.isObvBullish(obvSeries, opts.obv_lookback);
    const obvBearish = this.isObvBearish(obvSeries, opts.obv_lookback);
    const breakoutLong = this.isBreakoutLong(candles, opts.breakout_lookback, price);
    const breakoutShort = this.isBreakoutShort(candles, opts.breakout_lookback, price);

    const dailyLimitOk = this.tradeCountToday < opts.max_trades_per_day;
    const cooldownOk = this.cooldownRemaining <= 0;
    const macdCrossUp = macdPrev.histogram <= 0 && macdCurrent.histogram > 0;
    const macdCrossDown = macdPrev.histogram >= 0 && macdCurrent.histogram < 0;
    const macdMomentumLong = macdCurrent.histogram >= opts.macd_hist_min && macdCurrent.histogram >= macdPrev.histogram;
    const macdMomentumShort = macdCurrent.histogram <= -opts.macd_hist_min && macdCurrent.histogram <= macdPrev.histogram;
    const rsiRising = rsi >= rsiPrev;
    const rsiFalling = rsi <= rsiPrev;

    signal.debugAll({
      strategy: 'bounty_survival_v1',
      regime,
      adx: Number(adx.toFixed(3)),
      atr_ratio: Number(atrRatio.toFixed(6)),
      trend_distance: Number(trendDistance.toFixed(6)),
      trend_buffer_pct: opts.trend_buffer_pct,
      pair_symbol: opts.pair_symbol || '',
      ema_fast_slope_pct: Number(emaFastSlopePct.toFixed(6)),
      breakout_long: breakoutLong,
      breakout_short: breakoutShort,
      macd_momentum_long: macdMomentumLong,
      macd_momentum_short: macdMomentumShort,
      rsi_rising: rsiRising,
      rsi_falling: rsiFalling,
      obv_bullish: obvBullish,
      obv_bearish: obvBearish,
      trade_count_today: this.tradeCountToday,
      max_trades_per_day: opts.max_trades_per_day,
      cooldown_remaining: this.cooldownRemaining,
      position_bars: this.positionBars
    });

    if (context.lastSignal === 'long') {
      const shouldExit =
        macdCrossDown ||
        rsi >= opts.rsi_long_exit_max ||
        regime === 'bear' ||
        this.positionBars >= opts.hold_max_candles;
      if (shouldExit) {
        signal.close();
        this.cooldownRemaining = opts.cooldown_candles;
      }
      return;
    }

    if (context.lastSignal === 'short') {
      const shouldExit =
        macdCrossUp ||
        rsi <= opts.rsi_short_exit_min ||
        regime === 'bull' ||
        this.positionBars >= opts.hold_max_candles;
      if (shouldExit) {
        signal.close();
        this.cooldownRemaining = opts.cooldown_candles;
      }
      return;
    }

    if (!dailyLimitOk || !cooldownOk) {
      return;
    }

    const longRsiOk = rsi >= opts.rsi_long_min && rsi <= opts.rsi_long_max;
    const shortRsiOk = rsi >= opts.rsi_short_min && rsi <= opts.rsi_short_max;

    const longHardGate =
      regime === 'bull' &&
      adxOk &&
      atrOk &&
      trendBufferOkLong &&
      emaSlopeLongOk &&
      priceVsEmaFastLongOk &&
      (macdCrossUp || macdMomentumLong) &&
      (!opts.require_breakout || breakoutLong) &&
      (!opts.require_rsi_rising || rsiRising);

    const shortHardGate =
      regime === 'bear' &&
      emaFast < emaSlow &&
      adxOk &&
      atrOk &&
      trendBufferOkShort &&
      emaSlopeShortOk &&
      priceVsEmaFastShortOk &&
      (macdCrossDown || macdMomentumShort) &&
      (!opts.require_breakout || breakoutShort) &&
      (!opts.require_rsi_rising || rsiFalling) &&
      rsi <= opts.rsi_short_max;

    const longScore =
      (regime === 'bull' ? 1 : 0) +
      (adxOk ? 1 : 0) +
      (atrOk ? 1 : 0) +
      (obvBullish ? 1 : 0) +
      (longRsiOk ? 1 : 0) +
      (trendBufferOkLong ? 1 : 0) +
      (emaSlopeLongOk ? 1 : 0) +
      (breakoutLong ? 1 : 0);

    const shortScore =
      (regime === 'bear' ? 1 : 0) +
      (adxOk ? 1 : 0) +
      (atrOk ? 1 : 0) +
      (obvBearish ? 1 : 0) +
      (shortRsiOk ? 1 : 0) +
      (trendBufferOkShort ? 1 : 0) +
      (emaSlopeShortOk ? 1 : 0) +
      (breakoutShort ? 1 : 0);

    signal.debugAll({
      long_hard_gate: longHardGate,
      short_hard_gate: shortHardGate,
      long_score: longScore,
      short_score: shortScore,
      min_signal_score: opts.min_signal_score
    });

    if (opts.allow_long && longHardGate && longScore >= opts.min_signal_score) {
      signal.goLong();
      this.tradeCountToday += 1;
      return;
    }

    if (opts.allow_short && shortHardGate && shortScore >= opts.min_signal_score) {
      signal.goShort();
      this.tradeCountToday += 1;
      return;
    }
  }

  protected getDefaultOptions(): BountySurvivalV1Options {
    return {
      timeframe: '5m',
      ema_fast: 50,
      ema_slow: 200,
      adx_length: 14,
      adx_min: 24,
      rsi_length: 14,
      rsi_long_min: 50,
      rsi_long_max: 66,
      rsi_short_min: 36,
      rsi_short_max: 48,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      atr_length: 14,
      atr_ratio_min: 0.002,
      atr_ratio_max: 0.009,
      obv_lookback: 6,
      cooldown_candles: 14,
      max_trades_per_day: 2,
      min_signal_score: 6,
      trend_buffer_pct: 0.002,
      require_price_above_ema_fast: true,
      ema_fast_slope_lookback: 3,
      min_ema_fast_slope_pct: 0.0008,
      require_breakout: true,
      breakout_lookback: 10,
      require_rsi_rising: true,
      macd_hist_min: 0.0001,
      hold_max_candles: 60,
      rsi_long_exit_max: 70,
      rsi_short_exit_min: 28,
      allow_long: true,
      allow_short: false,
      pair_symbol: '',
      pair_exchange: '',
      pair_overrides: {
        'BNB/USDT:USDT': {
          adx_min: 22,
          min_signal_score: 5,
          trend_buffer_pct: 0.0018,
          require_breakout: false,
          allow_long: true,
          allow_short: false
        },
        'XRP/USDT:USDT': {
          adx_min: 24,
          min_signal_score: 6,
          trend_buffer_pct: 0.0022,
          require_breakout: true,
          allow_long: true,
          allow_short: false
        },
        'ETH/USDT:USDT': {
          allow_long: false,
          allow_short: false
        },
        'SOL/USDT:USDT': {
          allow_long: false,
          allow_short: false
        },
        'ADA/USDT:USDT': {
          allow_long: false,
          allow_short: false
        }
      }
    };
  }

  private getEffectiveOptions(): BountySurvivalV1Options {
    const symbolRaw = this.options.pair_symbol || '';
    const pairOverrides = this.options.pair_overrides || {};
    const normalizedSymbol = this.normalizePair(symbolRaw);
    const compactSymbol = this.normalizePair(symbolRaw.split(':')[0]?.replace('/', '') || '');

    for (const [key, override] of Object.entries(pairOverrides)) {
      const normalizedKey = this.normalizePair(key);
      if (normalizedKey && (normalizedKey === normalizedSymbol || normalizedKey === compactSymbol)) {
        return {
          ...this.options,
          ...override
        };
      }
    }

    return this.options;
  }

  private normalizePair(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  private rollDailyCounter(candleTime: number): void {
    const dayKey = new Date(candleTime * 1000).toISOString().slice(0, 10);
    if (this.lastTradeDate !== dayKey) {
      this.tradeCountToday = 0;
      this.lastTradeDate = dayKey;
    }
  }

  private updatePositionBars(lastSignal: 'long' | 'short' | 'close' | undefined): void {
    if (lastSignal === 'long' || lastSignal === 'short') {
      this.positionBars += 1;
    } else {
      this.positionBars = 0;
    }

    if (this.cooldownRemaining > 0) {
      this.cooldownRemaining -= 1;
    }
  }

  private detectRegime(price: number, emaFast: number, emaSlow: number): Regime {
    if (price > emaSlow && emaFast > emaSlow) {
      return 'bull';
    }
    if (price < emaSlow && emaFast < emaSlow) {
      return 'bear';
    }
    return 'neutral';
  }

  private lastNumber(series: Array<number | null>): number | null {
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (typeof series[i] === 'number') {
        return series[i] as number;
      }
    }
    return null;
  }

  private lastNumberAt(series: Array<number | null>, back: number): number | null {
    let seen = 0;
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (typeof series[i] !== 'number') {
        continue;
      }
      if (seen === back) {
        return series[i] as number;
      }
      seen += 1;
    }
    return null;
  }

  private lastMacd(series: Array<MacdResult | null>, back: number): MacdResult | null {
    const filtered = series.filter((v): v is MacdResult => v !== null);
    if (filtered.length <= back) {
      return null;
    }
    return filtered[filtered.length - 1 - back];
  }

  private isObvBullish(series: Array<number | null>, lookback: number): boolean {
    const filtered = series.filter((v): v is number => typeof v === 'number');
    if (filtered.length < lookback + 1) {
      return false;
    }
    const current = filtered[filtered.length - 1];
    const previous = filtered.slice(filtered.length - 1 - lookback, filtered.length - 1);
    const averagePrevious = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    return current > averagePrevious;
  }

  private isObvBearish(series: Array<number | null>, lookback: number): boolean {
    const filtered = series.filter((v): v is number => typeof v === 'number');
    if (filtered.length < lookback + 1) {
      return false;
    }
    const current = filtered[filtered.length - 1];
    const previous = filtered.slice(filtered.length - 1 - lookback, filtered.length - 1);
    const averagePrevious = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    return current < averagePrevious;
  }

  private isBreakoutLong(candles: Candlestick[], lookback: number, price: number): boolean {
    if (candles.length < lookback + 1) {
      return false;
    }
    const slice = candles.slice(candles.length - 1 - lookback, candles.length - 1);
    const highest = Math.max(...slice.map(c => c.high));
    return price > highest;
  }

  private isBreakoutShort(candles: Candlestick[], lookback: number, price: number): boolean {
    if (candles.length < lookback + 1) {
      return false;
    }
    const slice = candles.slice(candles.length - 1 - lookback, candles.length - 1);
    const lowest = Math.min(...slice.map(c => c.low));
    return price < lowest;
  }
}
