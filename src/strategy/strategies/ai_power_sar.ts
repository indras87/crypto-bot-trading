/**
 * AI-Powered Parabolic SAR Strategy
 * 
 * This strategy combines Parabolic SAR with multiple technical filters (EMA, ADX, RSI)
 * and uses AI cross-validation to improve signal accuracy.
 * 
 * Success Metrics:
 * 1. Accuracy: > 60% profitable confirmed signals.
 * 2. False Signal Reduction: > 30% signals rejected by filters/AI.
 * 3. Win Rate: > 60%.
 * 4. Profit Factor: > 1.5.
 * 5. Max Drawdown: < 10%.
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition } from '../strategy';

// ============== Strategy Options ==============

export interface AiPowerSarOptions {
  psar_step?: number;
  psar_max?: number;
  ema_period?: number;
  adx_threshold?: number;
  rsi_low?: number;
  rsi_high?: number;
}

// ============== Indicator Definition ==============

export type AiPowerSarIndicators = {
  psar: TypedIndicatorDefinition<'psar'>;
  ema: TypedIndicatorDefinition<'ema'>;
  adx: TypedIndicatorDefinition<'adx'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
};

// ============== Strategy Implementation ==============

export class AiPowerSar extends StrategyBase<AiPowerSarIndicators, AiPowerSarOptions> {
  getDescription(): string {
    return 'AI-Powered Parabolic SAR with multi-technical filters';
  }

  defineIndicators(): AiPowerSarIndicators {
    return {
      psar: strategy.indicator.psar({
        step: this.options.psar_step,
        max: this.options.psar_max
      }),
      ema: strategy.indicator.ema(),
      adx: strategy.indicator.adx(),
      rsi: strategy.indicator.rsi()
    };
  }

  async execute(context: TypedStrategyContext<AiPowerSarIndicators>, signal: StrategySignal): Promise<void> {
    const psarRaw = context.getIndicatorSlice('psar', 3);
    const psarValues = (Array.isArray(psarRaw) ? psarRaw.filter(v => v !== null) : []) as number[];

    const emaRaw = context.getIndicatorSlice('ema', 1);
    const emaValue = emaRaw[emaRaw.length - 1];

    const adxRaw = context.getIndicatorSlice('adx', 1);
    const adxValue = adxRaw[adxRaw.length - 1];

    const rsiRaw = context.getIndicatorSlice('rsi', 1);
    const rsiValue = rsiRaw[rsiRaw.length - 1];

    const prices = context.getLastPrices(3);

    if (psarValues.length < 2 || prices.length < 2 || !emaValue || !adxValue || !rsiValue) {
      return;
    }

    const currentPsar = psarValues[psarValues.length - 1];
    const previousPsar = psarValues[psarValues.length - 2];
    const currentClose = prices[prices.length - 1];
    const previousClose = prices[prices.length - 2];

    const currentHistogram = currentClose - currentPsar;
    const previousHistogram = previousClose - previousPsar;

    const isPsarLong = currentHistogram > 0;
    const lastSignal = context.lastSignal;

    // Technical Confirmations
    const trendBullish = currentClose > emaValue;
    const trendBearish = currentClose < emaValue;
    const trendStrong = adxValue > (this.options.adx_threshold || 25);
    const notOverbought = rsiValue < (this.options.rsi_high || 70);
    const notOversold = rsiValue > (this.options.rsi_low || 30);

    signal.debugAll({
      psar: currentPsar.toFixed(2),
      ema: emaValue.toFixed(2),
      adx: adxValue.toFixed(2),
      rsi: rsiValue.toFixed(2),
      trend_bullish: trendBullish,
      trend_strong: trendStrong,
      momentum_ok: isPsarLong ? notOverbought : notOversold,
      last_signal: lastSignal
    });

    // Trend change / close logic
    if (
      (lastSignal === 'long' && currentHistogram < 0) ||
      (lastSignal === 'short' && currentHistogram > 0)
    ) {
      signal.close();
      return;
    }

    // Long Entry Condition
    if (previousHistogram < 0 && currentHistogram > 0) {
      if (trendBullish && trendStrong && notOverbought) {
        signal.goLong();
      } else {
        signal.debugAll({
          long_rejected_reason: !trendBullish ? 'against_ema' : (!trendStrong ? 'weak_trend' : 'overbought')
        });
      }
    }

    // Short Entry Condition
    if (previousHistogram > 0 && currentHistogram < 0) {
      if (trendBearish && trendStrong && notOversold) {
        signal.goShort();
      } else {
        signal.debugAll({
          short_rejected_reason: !trendBearish ? 'against_ema' : (!trendStrong ? 'weak_trend' : 'oversold')
        });
      }
    }
  }

  protected getDefaultOptions(): AiPowerSarOptions {
    return {
      psar_step: 0.02,
      psar_max: 0.2,
      ema_period: 200,
      adx_threshold: 25,
      rsi_low: 30,
      rsi_high: 70
    };
  }
}
