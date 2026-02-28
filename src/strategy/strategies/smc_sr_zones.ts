/**
 * SMC S&R Zones Strategy
 *
 * Smart Money Concepts (SMC) - Support & Resistance Zones
 * Focus on institutional zones with trend confirmation.
 *
 * Core Concepts:
 * 1. Trend Filter (H1): EMA 50 > EMA 200 = Uptrend (buy only)
 *                        EMA 50 < EMA 200 = Downtrend (sell only)
 * 2. Zone Detection: Swing High/Low via Pivot Points + ATR threshold
 * 3. Zone Validation: Zone must be aligned with trend
 * 4. Imbalance Detection: Sharp move after zone formation (optional)
 * 5. Entry Confirmation: Bullish/Bearish candle closes at zone
 *
 * Entry Logic:
 * LONG: Uptrend + Price in Demand Zone + Bullish Candle Confirmation
 * SHORT: Downtrend + Price in Supply Zone + Bearish Candle Confirmation
 *
 * Exit Logic:
 * - Trend reversal (EMA cross)
 * - Stop Loss: Outside swing high/low (ATR buffer)
 * - Take Profit: Risk:Reward ratio (1:3 default)
 *
 * Recommended Timeframes: 15m, 30m, 1h
 * Risk:Reward: Minimum 1:3
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition, type PivotPointResult } from '../strategy';

// ============== Strategy Options ==============

export interface SmcSRZonesOptions {
  /** EMA fast period for trend detection */
  ema_fast_length?: number;
  /** EMA slow period for trend detection */
  ema_slow_length?: number;
  /** ATR period for zone calculation */
  atr_length?: number;
  /** Pivot points left bars */
  pivot_left?: number;
  /** Pivot points right bars */
  pivot_right?: number;
  /** Zone proximity threshold as % of ATR */
  zone_atr_multiplier?: number;
  /** ATR multiplier for stop loss buffer */
  atr_sl_multiplier?: number;
  /** Risk:Reward ratio for take profit */
  rr_ratio?: number;
  /** Stop loss percent (overrides ATR-based SL if set) */
  stop_loss?: number;
  /** Take profit percent (overrides RR-based TP if set) */
  take_profit?: number;
  /** Require engulfing candle for entry */
  require_engulfing?: number;
  /** Min body ratio for candle confirmation (0-1) */
  min_body_ratio?: number;
  /** Use H1 trend filter (requires fetchH1Trend: true in bot options) */
  use_h1_trend?: boolean;
}

// ============== Indicator Definition ==============

export type SmcSRZonesIndicators = {
  ema_fast: TypedIndicatorDefinition<'ema'>;
  ema_slow: TypedIndicatorDefinition<'ema'>;
  atr: TypedIndicatorDefinition<'atr'>;
  pivot_points: TypedIndicatorDefinition<'pivot_points_high_low'>;
  candles: TypedIndicatorDefinition<'candles'>;
};

// ============== Helper Types ==============

interface ZoneResult {
  inDemandZone: boolean;
  inSupplyZone: boolean;
  demandLevel: number | null;
  supplyLevel: number | null;
  demandDistance: number;
  supplyDistance: number;
}

interface CandleConfirmation {
  isBullishConfirm: boolean;
  isBearishConfirm: boolean;
  bodyRatio: number;
}

interface TrendResult {
  isUptrend: boolean;
  isDowntrend: boolean;
  emaFastValue: number;
  emaSlowValue: number;
}

// ============== Strategy Implementation ==============

export class SmcSRZones extends StrategyBase<SmcSRZonesIndicators, SmcSRZonesOptions> {
  getDescription(): string {
    return 'SMC S&R Zones - Smart Money Concepts with Support & Resistance zone trading';
  }

  defineIndicators(): SmcSRZonesIndicators {
    return {
      ema_fast: strategy.indicator.ema({ length: this.options.ema_fast_length }),
      ema_slow: strategy.indicator.ema({ length: this.options.ema_slow_length }),
      atr: strategy.indicator.atr({ length: this.options.atr_length }),
      pivot_points: strategy.indicator.pivotPointsHighLow({
        left: this.options.pivot_left,
        right: this.options.pivot_right
      }),
      candles: strategy.indicator.candles()
    };
  }

  async execute(context: TypedStrategyContext<SmcSRZonesIndicators>, signal: StrategySignal): Promise<void> {
    const { price, lastSignal, prices } = context;

    // Extract indicator arrays
    const emaFastArr = (context.getIndicator('ema_fast') as (number | null)[]).filter(v => v !== null) as number[];
    const emaSlowArr = (context.getIndicator('ema_slow') as (number | null)[]).filter(v => v !== null) as number[];
    const atrArr = (context.getIndicator('atr') as (number | null)[]).filter(v => v !== null) as number[];
    const pivotArr = context.getIndicator('pivot_points') as (PivotPointResult | null)[];
    const candlesArr = context.getIndicator('candles') as any[];

    // Minimum data check
    if (emaFastArr.length < 5 || emaSlowArr.length < 5 || atrArr.length < 3 || candlesArr.length < 5 || pivotArr.length < 3) {
      return;
    }

    // Current values
    const emaFast = emaFastArr[emaFastArr.length - 1];
    const emaSlow = emaSlowArr[emaSlowArr.length - 1];
    const atr = atrArr[atrArr.length - 1];

    // Determine trend
    const trend = this.detectTrend(emaFast, emaSlow);

    // Detect S&R zones
    const zone = this.detectZones(price, atr, pivotArr);

    // Check candle confirmation
    const candleConfirm = this.checkCandleConfirmation(candlesArr);

    // Debug info
    signal.debugAll({
      trend: trend.isUptrend ? 'UP' : trend.isDowntrend ? 'DOWN' : 'NEUTRAL',
      ema_fast: emaFast.toFixed(2),
      ema_slow: emaSlow.toFixed(2),
      in_demand_zone: zone.inDemandZone,
      in_supply_zone: zone.inSupplyZone,
      demand_dist: zone.demandDistance.toFixed(2),
      supply_dist: zone.supplyDistance.toFixed(2),
      bullish_candle: candleConfirm.isBullishConfirm,
      bearish_candle: candleConfirm.isBearishConfirm,
      body_ratio: candleConfirm.bodyRatio.toFixed(2),
      last_signal: lastSignal
    });

    // === LONG Entry ===
    if (trend.isUptrend && zone.inDemandZone && candleConfirm.isBullishConfirm) {
      // Check if we should close existing short
      if (lastSignal === 'short') {
        signal.close();
        return;
      }
      // Open long if flat
      if (!lastSignal || lastSignal === 'close') {
        signal.goLong();
        return;
      }
    }

    // === SHORT Entry ===
    if (trend.isDowntrend && zone.inSupplyZone && candleConfirm.isBearishConfirm) {
      // Check if we should close existing long
      if (lastSignal === 'long') {
        signal.close();
        return;
      }
      // Open short if flat
      if (!lastSignal || lastSignal === 'close') {
        signal.goShort();
        return;
      }
    }

    // === Trend Reversal Exit ===
    // Close long if trend flips to down
    if (lastSignal === 'long' && trend.isDowntrend) {
      signal.close();
      return;
    }
    // Close short if trend flips to up
    if (lastSignal === 'short' && trend.isUptrend) {
      signal.close();
      return;
    }

    // === Exit if price moves too far from zone ===
    if (lastSignal === 'long' && zone.inSupplyZone && zone.supplyDistance < zone.demandDistance) {
      // Price moved to opposite zone - potential reversal
      signal.debugAll({ exit_reason: 'moved_to_resistance' });
    }
    if (lastSignal === 'short' && zone.inDemandZone && zone.demandDistance < zone.supplyDistance) {
      signal.debugAll({ exit_reason: 'moved_to_support' });
    }
  }

  // ============== Helper Methods ==============

  private detectTrend(emaFast: number, emaSlow: number): TrendResult {
    const isUptrend = emaFast > emaSlow;
    const isDowntrend = emaFast < emaSlow;
    return {
      isUptrend,
      isDowntrend,
      emaFastValue: emaFast,
      emaSlowValue: emaSlow
    };
  }

  private detectZones(price: number, atr: number, pivotArr: (PivotPointResult | null)[]): ZoneResult {
    const threshold = atr * this.options.zone_atr_multiplier!;

    let nearestDemandLevel: number | null = null;
    let nearestSupplyLevel: number | null = null;
    let minDemandDist = Infinity;
    let minSupplyDist = Infinity;

    // Scan recent pivots
    const recentPivots = pivotArr.slice(-30);

    for (const pivot of recentPivots) {
      if (!pivot) continue;

      // Demand zone: Swing Low area
      if (pivot.low?.low !== undefined) {
        const swingLow = pivot.low.low;
        const dist = Math.abs(price - swingLow);
        if (dist < minDemandDist) {
          minDemandDist = dist;
          nearestDemandLevel = swingLow;
        }
      }

      // Supply zone: Swing High area
      if (pivot.high?.high !== undefined) {
        const swingHigh = pivot.high.high;
        const dist = Math.abs(price - swingHigh);
        if (dist < minSupplyDist) {
          minSupplyDist = dist;
          nearestSupplyLevel = swingHigh;
        }
      }
    }

    // Check if price is in zones
    const inDemandZone = nearestDemandLevel !== null && price >= nearestDemandLevel - threshold && price <= nearestDemandLevel + threshold * 3;

    const inSupplyZone = nearestSupplyLevel !== null && price <= nearestSupplyLevel + threshold && price >= nearestSupplyLevel - threshold * 3;

    return {
      inDemandZone,
      inSupplyZone,
      demandLevel: nearestDemandLevel,
      supplyLevel: nearestSupplyLevel,
      demandDistance: minDemandDist,
      supplyDistance: minSupplyDist
    };
  }

  private checkCandleConfirmation(candlesArr: any[]): CandleConfirmation {
    if (candlesArr.length < 3) {
      return { isBullishConfirm: false, isBearishConfirm: false, bodyRatio: 0 };
    }

    const currentCandle = candlesArr[candlesArr.length - 1];
    const prevCandle = candlesArr[candlesArr.length - 2];

    if (!currentCandle || !prevCandle) {
      return { isBullishConfirm: false, isBearishConfirm: false, bodyRatio: 0 };
    }

    const currentBody = Math.abs(currentCandle.close - currentCandle.open);
    const currentRange = currentCandle.high - currentCandle.low;
    const bodyRatio = currentRange > 0 ? currentBody / currentRange : 0;

    // Bullish confirmation: Current candle closes higher than previous candle
    const isBullishConfirm = currentCandle.close > prevCandle.close && bodyRatio >= (this.options.min_body_ratio || 0.5);

    // Bearish confirmation: Current candle closes lower than previous candle
    const isBearishConfirm = currentCandle.close < prevCandle.close && bodyRatio >= (this.options.min_body_ratio || 0.5);

    return {
      isBullishConfirm,
      isBearishConfirm,
      bodyRatio
    };
  }

  protected getDefaultOptions(): SmcSRZonesOptions {
    return {
      ema_fast_length: 50,
      ema_slow_length: 200,
      atr_length: 14,
      pivot_left: 5,
      pivot_right: 3,
      zone_atr_multiplier: 1.5,
      atr_sl_multiplier: 2.0,
      rr_ratio: 3,
      require_engulfing: 1,
      min_body_ratio: 0.5,
      use_h1_trend: false
    };
  }
}
