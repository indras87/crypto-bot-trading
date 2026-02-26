/**
 * Multi-Indicator Strategy - Comprehensive TA with 7-tier signal system
 *
 * Inspired by professional TA analyzers with 15+ indicators combined
 *
 * Core Indicators (Weight 1.0):
 * - RSI: Momentum oscillator
 * - MACD: Trend-following momentum
 * - BB (Bollinger Bands): Volatility & squeeze detection
 * - OBV: Volume confirmation
 * - ADX: Trend strength
 * - EMA Cross: Trend direction
 * - Ichimoku Cloud: Multi-component trend
 *
 * Strong Indicators (Weight 0.75):
 * - MFI: Money flow (volume-weighted RSI)
 * - CCI: Commodity Channel Index
 * - Stochastic: Overbought/oversold
 *
 * Supporting Indicators (Weight 0.5):
 * - ATR: Volatility measurement
 * - ROC: Rate of change
 * - AO: Awesome Oscillator
 * - PSAR: Trend reversal
 *
 * Signal System:
 * - STRONG_BUY: normalizedScore >= 0.5, confidence >= 0.7
 * - BUY: normalizedScore >= 0.35, confidence >= 0.5
 * - WEAK_BUY: normalizedScore >= 0.2
 * - NEUTRAL: -0.2 < normalizedScore < 0.2
 * - WEAK_SELL: normalizedScore <= -0.2
 * - SELL: normalizedScore <= -0.35, confidence >= 0.5
 * - STRONG_SELL: normalizedScore <= -0.5, confidence >= 0.7
 */

import strategy, {
  StrategyBase,
  TypedStrategyContext,
  StrategySignal,
  type TypedIndicatorDefinition,
  type MacdResult,
  type BollingerBandsResult,
  type StochResult,
  type IchimokuCloudResult
} from '../strategy';

export interface MultiIndicatorOptions {
  ema_short?: number;
  ema_long?: number;
  rsi_period?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  bb_period?: number;
  bb_stddev?: number;
  adx_period?: number;
  adx_threshold?: number;
  cci_period?: number;
  mfi_period?: number;
  stoch_k?: number;
  stoch_d?: number;
  atr_period?: number;
  roc_period?: number;
  obv_lookback?: number;
  min_confidence?: number;
}

export type MultiIndicatorIndicators = {
  ema_short: TypedIndicatorDefinition<'ema'>;
  ema_long: TypedIndicatorDefinition<'ema'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd'>;
  bb: TypedIndicatorDefinition<'bb'>;
  obv: TypedIndicatorDefinition<'obv'>;
  adx: TypedIndicatorDefinition<'adx'>;
  cci: TypedIndicatorDefinition<'cci'>;
  mfi: TypedIndicatorDefinition<'mfi'>;
  stoch: TypedIndicatorDefinition<'stoch'>;
  atr: TypedIndicatorDefinition<'atr'>;
  roc: TypedIndicatorDefinition<'roc'>;
  ao: TypedIndicatorDefinition<'ao'>;
  psar: TypedIndicatorDefinition<'psar'>;
  ichimoku: TypedIndicatorDefinition<'ichimoku_cloud'>;
};

interface IndicatorScore {
  name: string;
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  score: number;
  weight: number;
  details: Record<string, any>;
}

interface AnalysisResult {
  totalScore: number;
  normalizedScore: number;
  confidence: number;
  signal7Tier: string;
  individualScores: Record<string, IndicatorScore>;
  divergences: Record<string, string>;
  volumeConfirmation: number;
  trendStrength: number;
}

export class MultiIndicator extends StrategyBase<MultiIndicatorIndicators, MultiIndicatorOptions> {
  getDescription(): string {
    return 'Multi-indicator strategy with 15+ indicators and 7-tier signal system';
  }

  defineIndicators(): MultiIndicatorIndicators {
    return {
      ema_short: strategy.indicator.ema({ length: this.options.ema_short }),
      ema_long: strategy.indicator.ema({ length: this.options.ema_long }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_period }),
      macd: strategy.indicator.macd({
        fast_length: this.options.macd_fast,
        slow_length: this.options.macd_slow,
        signal_length: this.options.macd_signal
      }),
      bb: strategy.indicator.bb({ length: this.options.bb_period, stddev: this.options.bb_stddev }),
      obv: strategy.indicator.obv(),
      adx: strategy.indicator.adx({ length: this.options.adx_period }),
      cci: strategy.indicator.cci({ length: this.options.cci_period }),
      mfi: strategy.indicator.mfi({ length: this.options.mfi_period }),
      stoch: strategy.indicator.stoch({ length: this.options.stoch_k, k: this.options.stoch_k, d: this.options.stoch_d }),
      atr: strategy.indicator.atr({ length: this.options.atr_period }),
      roc: strategy.indicator.roc({ length: this.options.roc_period }),
      ao: strategy.indicator.ao(),
      psar: strategy.indicator.psar({ step: 0.02, max: 0.2 }),
      ichimoku: strategy.indicator.ichimokuCloud({ conversionPeriod: 9, basePeriod: 26, spanPeriod: 52, displacement: 26 })
    };
  }

  async execute(context: TypedStrategyContext<MultiIndicatorIndicators>, signal: StrategySignal): Promise<void> {
    const { price, lastSignal } = context;

    const emaShortArr = (context.getIndicator('ema_short') as (number | null)[]).filter(v => v !== null) as number[];
    const emaLongArr = (context.getIndicator('ema_long') as (number | null)[]).filter(v => v !== null) as number[];
    const rsiArr = (context.getIndicator('rsi') as (number | null)[]).filter(v => v !== null) as number[];
    const macdArr = (context.getIndicator('macd') as (MacdResult | null)[]).filter(v => v !== null) as MacdResult[];
    const bbArr = (context.getIndicator('bb') as (BollingerBandsResult | null)[]).filter(v => v !== null) as BollingerBandsResult[];
    const obvArr = (context.getIndicator('obv') as (number | null)[]).filter(v => v !== null) as number[];
    const adxArr = (context.getIndicator('adx') as (number | null)[]).filter(v => v !== null) as number[];
    const cciArr = (context.getIndicator('cci') as (number | null)[]).filter(v => v !== null) as number[];
    const mfiArr = (context.getIndicator('mfi') as (number | null)[]).filter(v => v !== null) as number[];
    const stochArr = (context.getIndicator('stoch') as (StochResult | null)[]).filter(v => v !== null) as StochResult[];
    const atrArr = (context.getIndicator('atr') as (number | null)[]).filter(v => v !== null) as number[];
    const rocArr = (context.getIndicator('roc') as (number | null)[]).filter(v => v !== null) as number[];
    const aoArr = (context.getIndicator('ao') as (number | null)[]).filter(v => v !== null) as number[];
    const psarArr = (context.getIndicator('psar') as (number | null)[]).filter(v => v !== null) as number[];
    const ichimokuArr = (context.getIndicator('ichimoku') as (IchimokuCloudResult | null)[]).filter(v => v !== null) as IchimokuCloudResult[];

    const minLen = 5;
    if (
      emaShortArr.length < minLen ||
      emaLongArr.length < minLen ||
      rsiArr.length < minLen ||
      macdArr.length < minLen ||
      bbArr.length < minLen ||
      adxArr.length < minLen
    ) {
      return;
    }

    const analysis = this.calculateAnalysis(price, {
      emaShort: emaShortArr,
      emaLong: emaLongArr,
      rsi: rsiArr,
      macd: macdArr,
      bb: bbArr,
      obv: obvArr,
      adx: adxArr,
      cci: cciArr,
      mfi: mfiArr,
      stoch: stochArr,
      atr: atrArr,
      roc: rocArr,
      ao: aoArr,
      psar: psarArr,
      ichimoku: ichimokuArr
    });

    signal.debugAll({
      totalScore: Math.round(analysis.totalScore * 100) / 100,
      normalizedScore: Math.round(analysis.normalizedScore * 100) / 100,
      confidence: Math.round(analysis.confidence * 100) / 100,
      signal7Tier: analysis.signal7Tier,
      trendStrength: Math.round(analysis.trendStrength * 100) / 100,
      volumeConfirmation: Math.round(analysis.volumeConfirmation * 100) / 100
    });

    if (lastSignal === 'long' && analysis.normalizedScore < -0.3) {
      signal.close();
      return;
    }
    if (lastSignal === 'short' && analysis.normalizedScore > 0.3) {
      signal.close();
      return;
    }

    if (lastSignal) {
      return;
    }

    if (analysis.signal7Tier === 'STRONG_BUY' || analysis.signal7Tier === 'BUY') {
      signal.goLong();
    } else if (analysis.signal7Tier === 'STRONG_SELL' || analysis.signal7Tier === 'SELL') {
      signal.goShort();
    }
  }

  private calculateAnalysis(
    price: number,
    data: {
      emaShort: number[];
      emaLong: number[];
      rsi: number[];
      macd: MacdResult[];
      bb: BollingerBandsResult[];
      obv: number[];
      adx: number[];
      cci: number[];
      mfi: number[];
      stoch: StochResult[];
      atr: number[];
      roc: number[];
      ao: number[];
      psar: number[];
      ichimoku: IchimokuCloudResult[];
    }
  ): AnalysisResult {
    const scores: IndicatorScore[] = [];
    const divergences: Record<string, string> = {};

    scores.push(this.scoreEMA(data.emaShort, data.emaLong, price));
    scores.push(this.scoreRSI(data.rsi, divergences));
    scores.push(this.scoreMACD(data.macd, divergences));
    scores.push(this.scoreBollingerBands(data.bb, price));
    scores.push(this.scoreOBV(data.obv, divergences));
    scores.push(this.scoreADX(data.adx));
    scores.push(this.scoreIchimoku(data.ichimoku, price));

    scores.push(this.scoreMFI(data.mfi));
    scores.push(this.scoreCCI(data.cci));
    scores.push(this.scoreStochastic(data.stoch));

    scores.push(this.scoreATR(data.atr, price));
    scores.push(this.scoreROC(data.roc));
    scores.push(this.scoreAO(data.ao));
    scores.push(this.scorePSAR(data.psar, price));

    const totalScore = scores.reduce((sum, s) => sum + s.score * s.weight, 0);
    const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
    const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    const agreeingIndicators = scores.filter(s => (normalizedScore > 0 && s.signal === 'BUY') || (normalizedScore < 0 && s.signal === 'SELL')).length;
    const confidence = scores.length > 0 ? agreeingIndicators / scores.length : 0;

    const adxValue = data.adx.length > 0 ? data.adx[data.adx.length - 1] : 0;
    const trendStrength = adxValue > 25 ? 1 : adxValue > 15 ? 0.5 : 0;

    const obvTrend = this.getOBVTrend(data.obv);
    const volumeConfirmation = obvTrend > 0 ? 0.7 + obvTrend * 0.3 : 0.5;

    const signal7Tier = this.getSignal7Tier(normalizedScore, confidence);

    return {
      totalScore,
      normalizedScore,
      confidence,
      signal7Tier,
      individualScores: Object.fromEntries(scores.map(s => [s.name, s])),
      divergences,
      volumeConfirmation,
      trendStrength
    };
  }

  private scoreEMA(emaShort: number[], emaLong: number[], price: number): IndicatorScore {
    const short = emaShort[emaShort.length - 1];
    const long = emaLong[emaLong.length - 1];
    const prevShort = emaShort[emaShort.length - 2];
    const prevLong = emaLong[emaLong.length - 2];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (short > long && prevShort <= prevLong) {
      signal = 'BUY';
      score = 1;
    } else if (short < long && prevShort >= prevLong) {
      signal = 'SELL';
      score = -1;
    } else if (short > long) {
      signal = 'BUY';
      score = 0.5;
    } else if (short < long) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'EMA', signal, score, weight: 1.0, details: { short: Math.round(short * 100) / 100, long: Math.round(long * 100) / 100 } };
  }

  private scoreRSI(rsi: number[], divergences: Record<string, string>): IndicatorScore {
    const current = rsi[rsi.length - 1];
    const prev = rsi[rsi.length - 2];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current <= 30 && prev < current) {
      signal = 'BUY';
      score = 1;
    } else if (current >= 70 && prev > current) {
      signal = 'SELL';
      score = -1;
    } else if (current < 40) {
      signal = 'BUY';
      score = 0.5;
    } else if (current > 60) {
      signal = 'SELL';
      score = -0.5;
    }

    divergences['RSI'] = 'NONE';

    return { name: 'RSI', signal, score, weight: 1.0, details: { value: Math.round(current * 100) / 100 } };
  }

  private scoreMACD(macd: MacdResult[], divergences: Record<string, string>): IndicatorScore {
    const current = macd[macd.length - 1];
    const prev = macd[macd.length - 2];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (prev.histogram < 0 && current.histogram > 0) {
      signal = 'BUY';
      score = 1;
    } else if (prev.histogram > 0 && current.histogram < 0) {
      signal = 'SELL';
      score = -1;
    } else if (current.histogram > 0) {
      signal = 'BUY';
      score = 0.5;
    } else if (current.histogram < 0) {
      signal = 'SELL';
      score = -0.5;
    }

    divergences['MACD'] = 'NONE';

    return { name: 'MACD', signal, score, weight: 1.0, details: { histogram: Math.round(current.histogram * 1000) / 1000 } };
  }

  private scoreBollingerBands(bb: BollingerBandsResult[], price: number): IndicatorScore {
    const current = bb[bb.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    const percentB = (price - current.lower) / (current.upper - current.lower);

    if (price < current.lower) {
      signal = 'BUY';
      score = 1;
    } else if (price > current.upper) {
      signal = 'SELL';
      score = -1;
    } else if (percentB < 0.2) {
      signal = 'BUY';
      score = 0.5;
    } else if (percentB > 0.8) {
      signal = 'SELL';
      score = -0.5;
    }

    const squeezeDetected = current.width < 0.05;

    return { name: 'BB', signal, score, weight: 1.0, details: { percentB: Math.round(percentB * 100) / 100, squeeze: squeezeDetected } };
  }

  private scoreOBV(obv: number[], divergences: Record<string, string>): IndicatorScore {
    if (obv.length < 10) {
      return { name: 'OBV', signal: 'NEUTRAL', score: 0, weight: 1.0, details: {} };
    }

    const recent = obv.slice(-5);
    const previous = obv.slice(-10, -5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (recentAvg > previousAvg * 1.05) {
      signal = 'BUY';
      score = 0.8;
    } else if (recentAvg < previousAvg * 0.95) {
      signal = 'SELL';
      score = -0.8;
    }

    divergences['OBV'] = 'NONE';

    return { name: 'OBV', signal, score, weight: 1.0, details: { trend: recentAvg > previousAvg ? 'UP' : 'DOWN' } };
  }

  private scoreADX(adx: number[]): IndicatorScore {
    const current = adx[adx.length - 1];
    const prev = adx.length > 1 ? adx[adx.length - 2] : current;

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;
    let trendStrength = current > 25 ? 'STRONG' : current > 15 ? 'MODERATE' : 'WEAK';

    if (current > 25 && current > prev) {
      score = 0.7;
      signal = 'BUY';
    } else if (current < 20) {
      score = 0;
      signal = 'NEUTRAL';
    }

    return { name: 'ADX', signal, score, weight: 1.0, details: { value: Math.round(current * 100) / 100, trend: trendStrength } };
  }

  private scoreIchimoku(ichimoku: IchimokuCloudResult[], price: number): IndicatorScore {
    if (ichimoku.length === 0) {
      return { name: 'ICHIMOKU', signal: 'NEUTRAL', score: 0, weight: 1.0, details: {} };
    }

    const current = ichimoku[ichimoku.length - 1];
    const cloudTop = Math.max(current.spanA, current.spanB);
    const cloudBottom = Math.min(current.spanA, current.spanB);

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (price > cloudTop && current.conversion > current.base) {
      signal = 'BUY';
      score = 1;
    } else if (price < cloudBottom && current.conversion < current.base) {
      signal = 'SELL';
      score = -1;
    } else if (price > cloudTop) {
      signal = 'BUY';
      score = 0.5;
    } else if (price < cloudBottom) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'ICHIMOKU', signal, score, weight: 1.0, details: { aboveCloud: price > cloudTop } };
  }

  private scoreMFI(mfi: number[]): IndicatorScore {
    if (mfi.length === 0) {
      return { name: 'MFI', signal: 'NEUTRAL', score: 0, weight: 0.75, details: {} };
    }

    const current = mfi[mfi.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current <= 20) {
      signal = 'BUY';
      score = 1;
    } else if (current >= 80) {
      signal = 'SELL';
      score = -1;
    } else if (current < 40) {
      signal = 'BUY';
      score = 0.5;
    } else if (current > 60) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'MFI', signal, score, weight: 0.75, details: { value: Math.round(current * 100) / 100 } };
  }

  private scoreCCI(cci: number[]): IndicatorScore {
    if (cci.length === 0) {
      return { name: 'CCI', signal: 'NEUTRAL', score: 0, weight: 0.75, details: {} };
    }

    const current = cci[cci.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current <= -100) {
      signal = 'BUY';
      score = 1;
    } else if (current >= 100) {
      signal = 'SELL';
      score = -1;
    } else if (current < 0) {
      signal = 'BUY';
      score = 0.3;
    } else if (current > 0) {
      signal = 'SELL';
      score = -0.3;
    }

    return { name: 'CCI', signal, score, weight: 0.75, details: { value: Math.round(current * 100) / 100 } };
  }

  private scoreStochastic(stoch: StochResult[]): IndicatorScore {
    if (stoch.length === 0) {
      return { name: 'STOCH', signal: 'NEUTRAL', score: 0, weight: 0.75, details: {} };
    }

    const current = stoch[stoch.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current.stoch_k <= 20 && current.stoch_k > current.stoch_d) {
      signal = 'BUY';
      score = 1;
    } else if (current.stoch_k >= 80 && current.stoch_k < current.stoch_d) {
      signal = 'SELL';
      score = -1;
    } else if (current.stoch_k < 30) {
      signal = 'BUY';
      score = 0.5;
    } else if (current.stoch_k > 70) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'STOCH', signal, score, weight: 0.75, details: { k: Math.round(current.stoch_k * 100) / 100, d: Math.round(current.stoch_d * 100) / 100 } };
  }

  private scoreATR(atr: number[], price: number): IndicatorScore {
    if (atr.length < 2) {
      return { name: 'ATR', signal: 'NEUTRAL', score: 0, weight: 0.5, details: {} };
    }

    const current = atr[atr.length - 1];
    const prev = atr[atr.length - 2];
    const atrPercent = (current / price) * 100;

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current > prev) {
      score = 0.3;
    } else {
      score = -0.3;
    }

    return { name: 'ATR', signal, score, weight: 0.5, details: { atrPercent: Math.round(atrPercent * 100) / 100 } };
  }

  private scoreROC(roc: number[]): IndicatorScore {
    if (roc.length === 0) {
      return { name: 'ROC', signal: 'NEUTRAL', score: 0, weight: 0.5, details: {} };
    }

    const current = roc[roc.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (current > 5) {
      signal = 'BUY';
      score = 1;
    } else if (current < -5) {
      signal = 'SELL';
      score = -1;
    } else if (current > 0) {
      signal = 'BUY';
      score = 0.5;
    } else if (current < 0) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'ROC', signal, score, weight: 0.5, details: { value: Math.round(current * 100) / 100 } };
  }

  private scoreAO(ao: number[]): IndicatorScore {
    if (ao.length < 2) {
      return { name: 'AO', signal: 'NEUTRAL', score: 0, weight: 0.5, details: {} };
    }

    const current = ao[ao.length - 1];
    const prev = ao[ao.length - 2];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (prev < 0 && current > 0) {
      signal = 'BUY';
      score = 1;
    } else if (prev > 0 && current < 0) {
      signal = 'SELL';
      score = -1;
    } else if (current > 0) {
      signal = 'BUY';
      score = 0.5;
    } else if (current < 0) {
      signal = 'SELL';
      score = -0.5;
    }

    return { name: 'AO', signal, score, weight: 0.5, details: { value: Math.round(current * 100) / 100 } };
  }

  private scorePSAR(psar: number[], price: number): IndicatorScore {
    if (psar.length === 0) {
      return { name: 'PSAR', signal: 'NEUTRAL', score: 0, weight: 0.5, details: {} };
    }

    const current = psar[psar.length - 1];

    let signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    let score = 0;

    if (price > current) {
      signal = 'BUY';
      score = 1;
    } else if (price < current) {
      signal = 'SELL';
      score = -1;
    }

    return { name: 'PSAR', signal, score, weight: 0.5, details: { belowPrice: price > current } };
  }

  private getOBVTrend(obv: number[]): number {
    if (obv.length < 10) return 0;
    const recent = obv.slice(-5);
    const previous = obv.slice(-10, -5);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const previousAvg = previous.reduce((a, b) => a + b, 0) / previous.length;
    if (previousAvg === 0) return 0;
    return (recentAvg - previousAvg) / Math.abs(previousAvg);
  }

  private getSignal7Tier(normalizedScore: number, confidence: number): string {
    if (normalizedScore >= 0.5 && confidence >= 0.7) return 'STRONG_BUY';
    if (normalizedScore >= 0.35 && confidence >= 0.5) return 'BUY';
    if (normalizedScore >= 0.2) return 'WEAK_BUY';
    if (normalizedScore <= -0.5 && confidence >= 0.7) return 'STRONG_SELL';
    if (normalizedScore <= -0.35 && confidence >= 0.5) return 'SELL';
    if (normalizedScore <= -0.2) return 'WEAK_SELL';
    return 'NEUTRAL';
  }

  protected getDefaultOptions(): MultiIndicatorOptions {
    return {
      ema_short: 9,
      ema_long: 21,
      rsi_period: 14,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      bb_period: 20,
      bb_stddev: 2,
      adx_period: 14,
      adx_threshold: 25,
      cci_period: 20,
      mfi_period: 14,
      stoch_k: 14,
      stoch_d: 3,
      atr_period: 14,
      roc_period: 10,
      obv_lookback: 10,
      min_confidence: 0.5
    };
  }
}
