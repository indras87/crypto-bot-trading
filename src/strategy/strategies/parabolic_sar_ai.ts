import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition } from '../strategy';

export interface ParabolicSarAiOptions {
  step?: number;
  max?: number;
  adx_length?: number;
  adx_threshold?: number;
  ema_length?: number;
  rsi_length?: number;
  rsi_min?: number;
  rsi_max?: number;
  min_ai_confidence?: number;
}

export type ParabolicSarAiIndicators = {
  psar: TypedIndicatorDefinition<'psar'>;
  adx: TypedIndicatorDefinition<'adx'>;
  ema: TypedIndicatorDefinition<'ema'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
};

export class ParabolicSarAi extends StrategyBase<ParabolicSarAiIndicators, ParabolicSarAiOptions> {
  getDescription(): string {
    return 'ParabolicSAR with AI validation - Trend following with multi-filter and AI cross-validation';
  }

  defineIndicators(): ParabolicSarAiIndicators {
    return {
      psar: strategy.indicator.psar({
        step: this.options.step,
        max: this.options.max
      }),
      adx: strategy.indicator.adx({ length: this.options.adx_length }),
      ema: strategy.indicator.ema({ length: this.options.ema_length }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length })
    };
  }

  async execute(context: TypedStrategyContext<ParabolicSarAiIndicators>, signal: StrategySignal): Promise<void> {
    const psarRaw = context.getIndicatorSlice('psar', 3);
    const adxRaw = context.getIndicatorSlice('adx', 3);
    const emaRaw = context.getIndicatorSlice('ema', 3);
    const rsiRaw = context.getIndicatorSlice('rsi', 3);

    const psarValues = (Array.isArray(psarRaw) ? psarRaw.filter(v => v !== null) : []) as number[];
    const adxValues = (Array.isArray(adxRaw) ? adxRaw.filter(v => v !== null) : []) as number[];
    const emaValues = (Array.isArray(emaRaw) ? emaRaw.filter(v => v !== null) : []) as number[];
    const rsiValues = (Array.isArray(rsiRaw) ? rsiRaw.filter(v => v !== null) : []) as number[];

    const prices = context.getLastPrices(3);

    if (psarValues.length < 2 || adxValues.length < 2 || emaValues.length < 2 || rsiValues.length < 2 || prices.length < 2) {
      return;
    }

    const currentPsar = psarValues[psarValues.length - 1];
    const previousPsar = psarValues[psarValues.length - 2];
    const currentClose = prices[prices.length - 1];
    const previousClose = prices[prices.length - 2];

    const currentHistogram = currentClose - currentPsar;
    const previousHistogram = previousClose - previousPsar;

    const adx = adxValues[adxValues.length - 1];
    const ema = emaValues[emaValues.length - 1];
    const rsi = rsiValues[rsiValues.length - 1];

    const isBullish = currentHistogram > 0;
    const lastSignal = context.lastSignal;

    const rsiOk = rsi >= this.options.rsi_min! && rsi <= this.options.rsi_max!;
    const isStrongTrend = adx > this.options.adx_threshold!;

    signal.debugAll({
      psar: Math.round(currentPsar * 100) / 100,
      histogram: Math.round(currentHistogram * 100) / 100,
      adx: Math.round(adx * 100) / 100,
      ema: Math.round(ema * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      last_signal: lastSignal,
      trend: isBullish ? 'bullish' : 'bearish',
      strong_trend: isStrongTrend,
      rsi_ok: rsiOk
    });

    if (lastSignal === 'long' && previousHistogram > 0 && currentHistogram < 0) {
      signal.close();
      return;
    }
    if (lastSignal === 'short' && previousHistogram < 0 && currentHistogram > 0) {
      signal.close();
      return;
    }

    if (lastSignal) {
      return;
    }

    if (isBullish && previousHistogram < 0 && currentHistogram > 0) {
      const priceAboveEma = currentClose > ema;

      if (isStrongTrend && priceAboveEma && rsiOk) {
        signal.debugAll({
          signal: 'LONG',
          triggered: true,
          filters_passed: 'psar_cross+adx+ema+rsi'
        });
        signal.goLong();
      }
      return;
    }

    if (!isBullish && previousHistogram > 0 && currentHistogram < 0) {
      const priceBelowEma = currentClose < ema;

      if (isStrongTrend && priceBelowEma && rsiOk) {
        signal.debugAll({
          signal: 'SHORT',
          triggered: true,
          filters_passed: 'psar_cross+adx+ema+rsi'
        });
        signal.goShort();
      }
      return;
    }
  }

  protected getDefaultOptions(): ParabolicSarAiOptions {
    return {
      step: 0.02,
      max: 0.2,
      adx_length: 14,
      adx_threshold: 25,
      ema_length: 200,
      rsi_length: 14,
      rsi_min: 30,
      rsi_max: 70,
      min_ai_confidence: 0.8
    };
  }
}
