/**
 * Survival Strategy - Conservative multi-filter strategy for small capital survival
 *
 * Long Entry (ALL conditions must be true):
 * 1. Price > EMA200 (trend bullish)
 * 2. ADX > threshold (strong trend, not sideways)
 * 3. RSI between long_min and long_max (not overbought)
 * 4. MACD histogram crosses above 0 (momentum up)
 * 5. OBV rising vs previous N candles (volume confirmation)
 *
 * Short Entry (ALL conditions must be true):
 * 1. Price < EMA200 (trend bearish)
 * 2. ADX > threshold (strong trend)
 * 3. RSI between short_min and short_max (not oversold)
 * 4. MACD histogram crosses below 0 (momentum down)
 * 5. OBV falling vs previous N candles
 *
 * Exit:
 * - MACD histogram reversal against position
 *
 * Recommended: 1h timeframe, max 5x leverage, position size 50-80%
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition, type MacdResult } from '../strategy';

export interface SurvivalOptions {
  ema_length?: number;
  adx_length?: number;
  adx_threshold?: number;
  rsi_length?: number;
  rsi_long_min?: number;
  rsi_long_max?: number;
  rsi_short_min?: number;
  rsi_short_max?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  obv_lookback?: number;
}

export type SurvivalIndicators = {
  ema: TypedIndicatorDefinition<'ema'>;
  adx: TypedIndicatorDefinition<'adx'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd'>;
  obv: TypedIndicatorDefinition<'obv'>;
};

export class Survival extends StrategyBase<SurvivalIndicators, SurvivalOptions> {
  getDescription(): string {
    return 'Conservative multi-filter strategy for small capital survival (EMA+ADX+RSI+MACD+OBV)';
  }

  defineIndicators(): SurvivalIndicators {
    return {
      ema: strategy.indicator.ema({ length: this.options.ema_length }),
      adx: strategy.indicator.adx({ length: this.options.adx_length }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length }),
      macd: strategy.indicator.macd({
        fast_length: this.options.macd_fast,
        slow_length: this.options.macd_slow,
        signal_length: this.options.macd_signal
      }),
      obv: strategy.indicator.obv()
    };
  }

  async execute(context: TypedStrategyContext<SurvivalIndicators>, signal: StrategySignal): Promise<void> {
    const { price, lastSignal } = context;

    const emaArr = (context.getIndicator('ema') as (number | null)[]).filter(v => v !== null) as number[];
    const adxArr = (context.getIndicator('adx') as (number | null)[]).filter(v => v !== null) as number[];
    const rsiArr = (context.getIndicator('rsi') as (number | null)[]).filter(v => v !== null) as number[];
    const macdArr = (context.getIndicator('macd') as (MacdResult | null)[]).filter(v => v !== null) as MacdResult[];
    const obvArr = (context.getIndicator('obv') as (number | null)[]).filter(v => v !== null) as number[];

    if (emaArr.length < 2 || adxArr.length < 2 || rsiArr.length < 2 || macdArr.length < 2 || obvArr.length < this.options.obv_lookback! + 1) {
      return;
    }

    const ema = emaArr[emaArr.length - 1];
    const adx = adxArr[adxArr.length - 1];
    const rsi = rsiArr[rsiArr.length - 1];
    const macdCurrent = macdArr[macdArr.length - 1];
    const macdBefore = macdArr[macdArr.length - 2];

    const obvCurrent = obvArr[obvArr.length - 1];
    const obvPrevious = obvArr.slice(-this.options.obv_lookback! - 1, -1);
    const obvAvgPrevious = obvPrevious.reduce((a, b) => a + b, 0) / obvPrevious.length;
    const obvRising = obvCurrent > obvAvgPrevious;
    const obvFalling = obvCurrent < obvAvgPrevious;

    const isBullishTrend = price > ema;
    const isBearishTrend = price < ema;
    const isStrongTrend = adx > this.options.adx_threshold!;

    signal.debugAll({
      ema: Math.round(ema * 100) / 100,
      adx: Math.round(adx * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      macd_hist: Math.round(macdCurrent.histogram * 100) / 100,
      obv_rising: obvRising,
      trend: isBullishTrend ? 'bullish' : 'bearish',
      strong: isStrongTrend
    });

    if (lastSignal === 'long' && macdBefore.histogram > 0 && macdCurrent.histogram < 0) {
      signal.close();
      return;
    }
    if (lastSignal === 'short' && macdBefore.histogram < 0 && macdCurrent.histogram > 0) {
      signal.close();
      return;
    }

    if (lastSignal) {
      return;
    }

    const longRsiOk = rsi >= this.options.rsi_long_min! && rsi <= this.options.rsi_long_max!;
    const longMacdCross = macdBefore.histogram < 0 && macdCurrent.histogram > 0;

    if (isBullishTrend && isStrongTrend && longRsiOk && longMacdCross && obvRising) {
      signal.debugAll({ signal: 'LONG', triggered: true });
      signal.goLong();
      return;
    }

    const shortRsiOk = rsi >= this.options.rsi_short_min! && rsi <= this.options.rsi_short_max!;
    const shortMacdCross = macdBefore.histogram > 0 && macdCurrent.histogram < 0;

    if (isBearishTrend && isStrongTrend && shortRsiOk && shortMacdCross && obvFalling) {
      signal.debugAll({ signal: 'SHORT', triggered: true });
      signal.goShort();
      return;
    }
  }

  protected getDefaultOptions(): SurvivalOptions {
    return {
      ema_length: 200,
      adx_length: 14,
      adx_threshold: 25,
      rsi_length: 14,
      rsi_long_min: 40,
      rsi_long_max: 70,
      rsi_short_min: 30,
      rsi_short_max: 60,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      obv_lookback: 5
    };
  }
}
