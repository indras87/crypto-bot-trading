import { Candlestick } from '../dict/candlestick';
import { indicators } from '../utils/indicators';

export interface TAScore {
  scoreTotal: number;
  normalizedScore: number;
  confidence: number;
  volumeConfirmation: number;
}

export interface TASignal {
  signal7Tier: 'STRONG_BUY' | 'BUY' | 'WEAK_BUY' | 'NEUTRAL' | 'WEAK_SELL' | 'SELL' | 'STRONG_SELL';
  signal: 'long' | 'short' | 'close' | undefined;
  trigger: boolean;
}

export interface Divergences {
  rsi: 'BULLISH_DIV' | 'BEARISH_DIV' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
  macd: 'BULLISH_DIV' | 'BEARISH_DIV' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
  obv: 'BULLISH_DIV' | 'BEARISH_DIV' | 'HIDDEN_BULLISH' | 'HIDDEN_BEARISH' | 'NONE';
}

export interface AdvancedTAResult {
  score: TAScore;
  signal: TASignal;
  divergences: Divergences;
  squeeze: boolean;
  currentPrice: number;
  priceChange24h: number;
  indicators: {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    bb: { upper: number; middle: number; lower: number; width: number };
    ema50: number;
    ema200: number;
    adx: number;
    atr: number;
    mfi: number;
    obv: number;
    cci: number;
    ao: number;
    sar: number;
  };
}

interface IndicatorValues {
  rsi: number[];
  macd: { macd: number; signal: number; histogram: number }[];
  bb: { upper: number; middle: number; lower: number; width: number }[];
  ema50: number[];
  ema200: number[];
  adx: number[];
  atr: number[];
  mfi: number[];
  obv: number[];
  cci: number[];
  ao: number[];
  psar: number[];
  closes: number[];
}

function lastValue<T>(arr: T[], fallback: T): T {
  return arr.length > 0 ? arr[arr.length - 1] : fallback;
}

function previousValue<T>(arr: T[], fallback: T): T {
  return arr.length > 1 ? arr[arr.length - 2] : fallback;
}

function findSwingLows(closes: number[], lookback: number = 10): number[] {
  const lows: number[] = [];
  for (let i = lookback; i < closes.length - lookback; i++) {
    let isSwingLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (closes[i - j] <= closes[i] || closes[i + j] <= closes[i]) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) lows.push(i);
  }
  return lows;
}

function findSwingHighs(closes: number[], lookback: number = 10): number[] {
  const highs: number[] = [];
  for (let i = lookback; i < closes.length - lookback; i++) {
    let isSwingHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (closes[i - j] >= closes[i] || closes[i + j] >= closes[i]) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) highs.push(i);
  }
  return highs;
}

function detectDivergence(priceData: number[], indicatorData: number[], lookback: number = 20): Divergences['rsi'] {
  if (priceData.length < lookback * 2 || indicatorData.length < lookback * 2) {
    return 'NONE';
  }

  const priceSwingLows = findSwingLows(priceData, 5);
  const priceSwingHighs = findSwingHighs(priceData, 5);

  if (priceSwingLows.length < 2) {
    const recentPriceLow = Math.min(...priceData.slice(-lookback));
    const olderPriceLow = Math.min(...priceData.slice(-lookback * 2, -lookback));
    const recentIndicatorLow = Math.min(...indicatorData.slice(-lookback));
    const olderIndicatorLow = Math.min(...indicatorData.slice(-lookback * 2, -lookback));

    if (recentPriceLow < olderPriceLow && recentIndicatorLow > olderIndicatorLow) {
      return 'BULLISH_DIV';
    }
    if (recentPriceLow > olderPriceLow && recentIndicatorLow < olderIndicatorLow) {
      return 'HIDDEN_BULLISH';
    }
  }

  if (priceSwingHighs.length < 2) {
    const recentPriceHigh = Math.max(...priceData.slice(-lookback));
    const olderPriceHigh = Math.max(...priceData.slice(-lookback * 2, -lookback));
    const recentIndicatorHigh = Math.max(...indicatorData.slice(-lookback));
    const olderIndicatorHigh = Math.max(...indicatorData.slice(-lookback * 2, -lookback));

    if (recentPriceHigh > olderPriceHigh && recentIndicatorHigh < olderIndicatorHigh) {
      return 'BEARISH_DIV';
    }
    if (recentPriceHigh < olderPriceHigh && recentIndicatorHigh > olderIndicatorHigh) {
      return 'HIDDEN_BEARISH';
    }
  }

  return 'NONE';
}

function calculateScore(indicators: IndicatorValues): TAScore {
  const closesLength = indicators.closes.length;
  if (closesLength < 50) {
    return { scoreTotal: 0, normalizedScore: 0, confidence: 0, volumeConfirmation: 0 };
  }

  let totalScore = 0;
  let weights = 0;

  const rsi = lastValue(indicators.rsi, 50);
  const rsiWeight = 1.0;
  if (rsi >= 30 && rsi <= 70) {
    totalScore += rsiWeight * 1.0;
  } else if (rsi < 30) {
    totalScore += rsiWeight * 0.8;
  } else {
    totalScore += rsiWeight * 0.2;
  }
  weights += rsiWeight;

  const macd = lastValue(indicators.macd, { macd: 0, signal: 0, histogram: 0 });
  const macdPrev = previousValue(indicators.macd, macd);
  const macdWeight = 1.0;
  if (macd.histogram > 0 && macdPrev.histogram <= 0) {
    totalScore += macdWeight * 1.0;
  } else if (macd.histogram > 0) {
    totalScore += macdWeight * 0.7;
  } else if (macd.histogram < 0 && macdPrev.histogram >= 0) {
    totalScore -= macdWeight * 1.0;
  } else {
    totalScore -= macdWeight * 0.7;
  }
  weights += macdWeight;

  const bb = lastValue(indicators.bb, { upper: 0, middle: 0, lower: 0, width: 0 });
  const bbWeight = 1.0;
  if (bb.upper > bb.lower) {
    const price = lastValue(indicators.closes, 0);
    const percentB = (price - bb.lower) / (bb.upper - bb.lower);
    if (percentB > 0.2 && percentB < 0.8) {
      totalScore += bbWeight * 0.8;
    } else if (percentB >= 0.8 && percentB <= 1.0) {
      totalScore += bbWeight * 0.5;
    } else if (percentB > 1.0) {
      totalScore -= bbWeight * 0.3;
    } else {
      totalScore += bbWeight * 0.3;
    }
  }
  weights += bbWeight;

  const ema50 = lastValue(indicators.ema50, 0);
  const ema200 = lastValue(indicators.ema200, 0);
  const emaWeight = 1.0;
  if (ema50 > ema200) {
    totalScore += emaWeight * 1.0;
  } else {
    totalScore -= emaWeight * 1.0;
  }
  weights += emaWeight;

  const adx = lastValue(indicators.adx, 0);
  const adxWeight = 0.75;
  if (adx >= 25) {
    totalScore += adxWeight * 1.0;
  } else if (adx >= 20) {
    totalScore += adxWeight * 0.5;
  } else {
    totalScore -= adxWeight * 0.3;
  }
  weights += adxWeight;

  const mfi = lastValue(indicators.mfi, 50);
  const mfiWeight = 0.75;
  if (mfi >= 30 && mfi <= 70) {
    totalScore += mfiWeight * 0.8;
  } else if (mfi < 30) {
    totalScore += mfiWeight * 0.5;
  } else {
    totalScore -= mfiWeight * 0.3;
  }
  weights += mfiWeight;

  const cci = lastValue(indicators.cci, 0);
  const cciWeight = 0.5;
  if (cci > -100 && cci < 100) {
    totalScore += cciWeight * 0.8;
  } else if (cci <= -100) {
    totalScore += cciWeight * 0.5;
  } else {
    totalScore -= cciWeight * 0.5;
  }
  weights += cciWeight;

  const ao = lastValue(indicators.ao, 0);
  const aoWeight = 0.5;
  if (ao > 0) {
    totalScore += aoWeight * 0.8;
  } else {
    totalScore -= aoWeight * 0.8;
  }
  weights += aoWeight;

  const volumeScore = (mfi / 100) * 0.5 + (adx / 50) * 0.5;
  const volumeConfirmation = Math.min(1, Math.max(0, volumeScore));

  const scoreTotal = (totalScore / weights) * 10;
  const normalizedScore = Math.max(-10, Math.min(10, scoreTotal)) / 10;

  const atr = Math.max(lastValue(indicators.atr, 1), 1e-9);
  const signalStrength = Math.abs(macd.histogram) / atr;
  const rsiStrength = rsi > 30 && rsi < 70 ? 0.8 : 0.4;
  const trendStrength = adx >= 25 ? 0.8 : 0.4;
  const confidence = Math.min(1, signalStrength * 0.4 + rsiStrength * 0.3 + trendStrength * 0.3);

  return {
    scoreTotal: Math.round(scoreTotal * 100) / 100,
    normalizedScore: Math.round(normalizedScore * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    volumeConfirmation: Math.round(volumeConfirmation * 100) / 100
  };
}

function getSignal(score: TAScore): TASignal {
  const { normalizedScore, confidence } = score;

  let signal7Tier: TASignal['signal7Tier'];
  let signal: TASignal['signal'] = undefined;
  let trigger = false;

  if (normalizedScore >= 0.5 && confidence >= 0.7) {
    signal7Tier = 'STRONG_BUY';
    signal = 'long';
    trigger = true;
  } else if (normalizedScore >= 0.35 && confidence >= 0.5) {
    signal7Tier = 'BUY';
    signal = 'long';
    trigger = true;
  } else if (normalizedScore >= 0.2) {
    signal7Tier = 'WEAK_BUY';
    signal = undefined;
  } else if (normalizedScore <= -0.5 && confidence >= 0.7) {
    signal7Tier = 'STRONG_SELL';
    signal = 'short';
    trigger = true;
  } else if (normalizedScore <= -0.35 && confidence >= 0.5) {
    signal7Tier = 'SELL';
    signal = 'short';
    trigger = true;
  } else if (normalizedScore <= -0.2) {
    signal7Tier = 'WEAK_SELL';
    signal = undefined;
  } else {
    signal7Tier = 'NEUTRAL';
  }

  return { signal7Tier, signal, trigger };
}

function detectSqueeze(bb: { width: number }[], lookback: number = 20): boolean {
  if (bb.length < lookback) return false;

  const recentWidths = bb.slice(-lookback).map(b => b.width);
  const avgWidth = recentWidths.reduce((a, b) => a + b, 0) / recentWidths.length;
  const currentWidth = bb[bb.length - 1]?.width ?? avgWidth;

  return currentWidth < avgWidth * 0.75;
}

export class AdvancedTA {
  async analyze(candles: Candlestick[]): Promise<AdvancedTAResult> {
    if (candles.length < 100) {
      throw new Error('Need at least 100 candles for analysis');
    }

    const closes = candles.map(c => c.close);

    const [rsiResult, macdResult, bbResult, ema50Result, ema200Result, adxResult, atrResult, mfiResult, obvResult, cciResult, aoResult, psarResult] =
      await Promise.all([
        indicators.rsi(closes, { key: 'rsi', indicator: 'rsi', options: { length: 14 } }),
        indicators.macd(closes, { key: 'macd', indicator: 'macd', options: { fast_length: 12, slow_length: 26, signal_length: 9 } }),
        indicators.bb(closes, { key: 'bb', indicator: 'bb', options: { length: 20, stddev: 2 } }),
        indicators.ema(closes, { key: 'ema50', indicator: 'ema', options: { length: 50 } }),
        indicators.ema(closes, { key: 'ema200', indicator: 'ema', options: { length: 200 } }),
        indicators.adx(candles, { key: 'adx', indicator: 'adx', options: { length: 14 } }),
        indicators.atr(candles, { key: 'atr', indicator: 'atr', options: { length: 14 } }),
        indicators.mfi(candles, { key: 'mfi', indicator: 'mfi', options: { length: 14 } }),
        indicators.obv(candles, { key: 'obv', indicator: 'obv' }),
        indicators.cci(candles, { key: 'cci', indicator: 'cci', options: { length: 20 } }),
        indicators.ao(candles, { key: 'ao', indicator: 'ao' }),
        indicators.psar(candles, { key: 'psar', indicator: 'psar', options: { step: 0.02, max: 0.2 } })
      ]);

    const indicatorValues: IndicatorValues = {
      rsi: rsiResult.rsi,
      macd: macdResult.macd,
      bb: bbResult.bb,
      ema50: ema50Result.ema50,
      ema200: ema200Result.ema200,
      adx: adxResult.adx,
      atr: atrResult.atr,
      mfi: mfiResult.mfi,
      obv: obvResult.obv,
      cci: cciResult.cci,
      ao: aoResult.ao,
      psar: psarResult.psar,
      closes
    };

    const n = closes.length;
    const priceChange24h = n >= 24 ? ((closes[n - 1] - closes[n - 24]) / closes[n - 24]) * 100 : 0;

    const divergences: Divergences = {
      rsi: detectDivergence(closes, indicatorValues.rsi),
      macd: detectDivergence(
        closes,
        indicatorValues.macd.map(m => m.histogram)
      ),
      obv: detectDivergence(indicatorValues.obv, indicatorValues.rsi)
    };

    const squeeze = detectSqueeze(indicatorValues.bb);
    const score = calculateScore(indicatorValues);
    const signal = getSignal(score);

    return {
      score,
      signal,
      divergences,
      squeeze,
      currentPrice: closes[n - 1],
      priceChange24h: Math.round(priceChange24h * 100) / 100,
      indicators: {
        rsi: Math.round(lastValue(indicatorValues.rsi, 50) * 100) / 100,
        macd: lastValue(indicatorValues.macd, { macd: 0, signal: 0, histogram: 0 }),
        bb: lastValue(indicatorValues.bb, { upper: 0, middle: 0, lower: 0, width: 0 }),
        ema50: Math.round(lastValue(indicatorValues.ema50, 0) * 100) / 100,
        ema200: Math.round(lastValue(indicatorValues.ema200, 0) * 100) / 100,
        adx: Math.round(lastValue(indicatorValues.adx, 0) * 100) / 100,
        atr: Math.round(lastValue(indicatorValues.atr, 0) * 100) / 100,
        mfi: Math.round(lastValue(indicatorValues.mfi, 50) * 100) / 100,
        obv: Math.round(lastValue(indicatorValues.obv, 0)),
        cci: Math.round(lastValue(indicatorValues.cci, 0)),
        ao: Math.round(lastValue(indicatorValues.ao, 0) * 100) / 100,
        sar: Math.round(lastValue(indicatorValues.psar, 0) * 100) / 100
      }
    };
  }
}

export default AdvancedTA;
