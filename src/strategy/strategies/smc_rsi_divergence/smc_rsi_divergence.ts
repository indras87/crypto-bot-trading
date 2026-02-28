/**
 * SMC + RSI Divergence Strategy
 *
 * Smart Money Concepts (SMC) combined with RSI Divergence for high-accuracy reversal entries.
 *
 * Core Concepts:
 * 1. Supply & Demand Zones: Identified via Pivot Points High/Low
 * 2. RSI Divergence: Detects momentum weakness before entry
 * 3. Trend Filter: EMA 50 vs EMA 200 as H1 trend proxy
 * 4. Engulfing Candle: Confirmation pattern at zone
 * 5. RSI Based MA: RSI vs its own SMA as momentum filter
 *
 * Entry Logic:
 * LONG: Uptrend (EMA50 > EMA200) + Price near Demand Zone + Bullish RSI Divergence
 *       + Bullish Engulfing + RSI > RSI-MA
 * SHORT: Downtrend (EMA50 < EMA200) + Price near Supply Zone + Bearish RSI Divergence
 *        + Bearish Engulfing + RSI < RSI-MA
 *
 * Exit Logic:
 * - Auto close when trend reverses (EMA cross)
 * - SL/TP calculated via ATR (stop_loss / take_profit options in percent)
 *
 * Recommended Timeframes: 15m, 30m, 1h
 * Risk:Reward: Minimum 1:3
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition, type PivotPointResult } from '../../strategy';

// ============== Strategy Options ==============

export interface SmcRsiDivergenceOptions {
  /** EMA fast period for trend detection (proxy for H1 short-term trend) */
  ema_fast_length?: number;
  /** EMA slow period for trend detection (proxy for H1 long-term trend) */
  ema_slow_length?: number;
  /** RSI period */
  rsi_length?: number;
  /** SMA period applied to RSI values (RSI-Based MA) */
  rsi_ma_length?: number;
  /** ATR period for stop loss calculation */
  atr_length?: number;
  /** Pivot points left bars */
  pivot_left?: number;
  /** Pivot points right bars */
  pivot_right?: number;
  /** Number of candles to look back for divergence detection */
  divergence_lookback?: number;
  /** Zone proximity threshold as % of ATR (how close price must be to zone) */
  zone_atr_multiplier?: number;
  /** ATR multiplier for stop loss buffer below/above swing */
  atr_sl_multiplier?: number;
  /** Risk:Reward ratio for take profit calculation */
  rr_ratio?: number;
  /** Stop loss percent (overrides ATR-based SL if set) */
  stop_loss?: number;
  /** Take profit percent (overrides RR-based TP if set) */
  take_profit?: number;
}

// ============== Indicator Definition ==============

export type SmcRsiDivergenceIndicators = {
  ema_fast: TypedIndicatorDefinition<'ema'>;
  ema_slow: TypedIndicatorDefinition<'ema'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  atr: TypedIndicatorDefinition<'atr'>;
  pivot_points: TypedIndicatorDefinition<'pivot_points_high_low'>;
  candles: TypedIndicatorDefinition<'candles'>;
};

// ============== Helper Types ==============

interface DivergenceResult {
  hasBullish: boolean;
  hasBearish: boolean;
  bullishStrength: number; // 0-1, higher = stronger divergence
  bearishStrength: number;
}

interface ZoneResult {
  inDemandZone: boolean;
  inSupplyZone: boolean;
  nearestDemandLevel: number | null;
  nearestSupplyLevel: number | null;
}

interface EngulfingResult {
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
}

// ============== Strategy Implementation ==============

export class SmcRsiDivergence extends StrategyBase<SmcRsiDivergenceIndicators, SmcRsiDivergenceOptions> {
  getDescription(): string {
    return 'SMC + RSI Divergence - Smart Money Concepts with RSI divergence for reversal entries';
  }

  defineIndicators(): SmcRsiDivergenceIndicators {
    return {
      ema_fast: strategy.indicator.ema({ length: this.options.ema_fast_length }),
      ema_slow: strategy.indicator.ema({ length: this.options.ema_slow_length }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length }),
      atr: strategy.indicator.atr({ length: this.options.atr_length }),
      pivot_points: strategy.indicator.pivotPointsHighLow({
        left: this.options.pivot_left,
        right: this.options.pivot_right
      }),
      candles: strategy.indicator.candles()
    };
  }

  async execute(context: TypedStrategyContext<SmcRsiDivergenceIndicators>, signal: StrategySignal): Promise<void> {
    const { price, lastSignal } = context;

    // ── Extract indicator arrays ──────────────────────────────────────────────
    const emaFastArr = (context.getIndicator('ema_fast') as (number | null)[]).filter(v => v !== null) as number[];
    const emaSlowArr = (context.getIndicator('ema_slow') as (number | null)[]).filter(v => v !== null) as number[];
    const rsiArr = (context.getIndicator('rsi') as (number | null)[]).filter(v => v !== null) as number[];
    const atrArr = (context.getIndicator('atr') as (number | null)[]).filter(v => v !== null) as number[];
    const pivotArr = context.getIndicator('pivot_points') as (PivotPointResult | null)[];
    const candlesArr = context.getIndicator('candles') as any[];

    // ── Minimum data check ────────────────────────────────────────────────────
    const rsiMaPeriod = this.options.rsi_ma_length!;

    if (
      emaFastArr.length < 5 ||
      emaSlowArr.length < 5 ||
      rsiArr.length < Math.max(this.options.divergence_lookback!, rsiMaPeriod) ||
      atrArr.length < 3 ||
      candlesArr.length < 3
    ) {
      return;
    }

    // ── Current values ────────────────────────────────────────────────────────
    const emaFast = emaFastArr[emaFastArr.length - 1];
    const emaSlow = emaSlowArr[emaSlowArr.length - 1];
    const rsi = rsiArr[rsiArr.length - 1];
    const atr = atrArr[atrArr.length - 1];

    // ── RSI-Based MA: Calculate SMA of RSI values manually ───────────────────
    // This is the "RSI Based MA" filter — SMA applied to RSI values, not price
    const rsiMa = this.calculateRsiMa(rsiArr, rsiMaPeriod);
    if (rsiMa === null) {
      return;
    }

    // ── Trend Direction ───────────────────────────────────────────────────────
    const isUptrend = emaFast > emaSlow;
    const isDowntrend = emaFast < emaSlow;

    // ── Close existing position on trend reversal ─────────────────────────────
    if (lastSignal === 'long' && isDowntrend) {
      signal.close();
      signal.debugAll({
        close_reason: 'trend_reversal_bearish',
        ema_fast: emaFast.toFixed(2),
        ema_slow: emaSlow.toFixed(2)
      });
      return;
    }

    if (lastSignal === 'short' && isUptrend) {
      signal.close();
      signal.debugAll({
        close_reason: 'trend_reversal_bullish',
        ema_fast: emaFast.toFixed(2),
        ema_slow: emaSlow.toFixed(2)
      });
      return;
    }

    // ── Only open new positions when flat ────────────────────────────────────
    if (lastSignal === 'long' || lastSignal === 'short') {
      return;
    }

    // ── Supply/Demand Zone Detection ──────────────────────────────────────────
    const zoneResult = this.detectZones(price, atr, pivotArr);

    // ── RSI Divergence Detection ──────────────────────────────────────────────
    const prices = context.getLastPrices(this.options.divergence_lookback! + 2);
    const recentRsi = rsiArr.slice(-this.options.divergence_lookback! - 2);
    const divergence = this.detectDivergence(prices, recentRsi, this.options.divergence_lookback!);

    // ── Engulfing Pattern Detection ───────────────────────────────────────────
    const engulfing = this.detectEngulfing(candlesArr);

    // ── RSI Based MA Filter ───────────────────────────────────────────────────
    const rsiAboveMa = rsi > rsiMa;
    const rsiBelowMa = rsi < rsiMa;

    // ── Debug Output ──────────────────────────────────────────────────────────
    signal.debugAll({
      ema_fast: emaFast.toFixed(2),
      ema_slow: emaSlow.toFixed(2),
      trend: isUptrend ? 'uptrend' : isDowntrend ? 'downtrend' : 'sideways',
      rsi: rsi.toFixed(2),
      rsi_ma: rsiMa.toFixed(2),
      rsi_above_ma: rsiAboveMa,
      atr: atr.toFixed(4),
      in_demand_zone: zoneResult.inDemandZone,
      in_supply_zone: zoneResult.inSupplyZone,
      demand_level: zoneResult.nearestDemandLevel?.toFixed(2) ?? 'none',
      supply_level: zoneResult.nearestSupplyLevel?.toFixed(2) ?? 'none',
      bullish_divergence: divergence.hasBullish,
      bearish_divergence: divergence.hasBearish,
      bullish_engulfing: engulfing.isBullishEngulfing,
      bearish_engulfing: engulfing.isBearishEngulfing
    });

    // ── LONG Entry ────────────────────────────────────────────────────────────
    // Conditions: Uptrend + In Demand Zone + Bullish RSI Divergence + Bullish Engulfing + RSI > RSI-MA
    if (
      isUptrend &&
      zoneResult.inDemandZone &&
      divergence.hasBullish &&
      engulfing.isBullishEngulfing &&
      rsiAboveMa
    ) {
      const stopLossPrice = this.calculateLongStopLoss(price, atr, zoneResult.nearestDemandLevel);
      const takeProfitPrice = this.calculateLongTakeProfit(price, stopLossPrice);

      signal.debugAll({
        signal: 'LONG',
        entry_price: price.toFixed(2),
        stop_loss: stopLossPrice.toFixed(2),
        take_profit: takeProfitPrice.toFixed(2),
        sl_distance_pct: (((price - stopLossPrice) / price) * 100).toFixed(2),
        tp_distance_pct: (((takeProfitPrice - price) / price) * 100).toFixed(2),
        divergence_strength: divergence.bullishStrength.toFixed(2),
        confluences: 'uptrend+demand_zone+bullish_divergence+bullish_engulfing+rsi_above_ma'
      });

      signal.goLong();
      return;
    }

    // ── SHORT Entry ───────────────────────────────────────────────────────────
    // Conditions: Downtrend + In Supply Zone + Bearish RSI Divergence + Bearish Engulfing + RSI < RSI-MA
    if (
      isDowntrend &&
      zoneResult.inSupplyZone &&
      divergence.hasBearish &&
      engulfing.isBearishEngulfing &&
      rsiBelowMa
    ) {
      const stopLossPrice = this.calculateShortStopLoss(price, atr, zoneResult.nearestSupplyLevel);
      const takeProfitPrice = this.calculateShortTakeProfit(price, stopLossPrice);

      signal.debugAll({
        signal: 'SHORT',
        entry_price: price.toFixed(2),
        stop_loss: stopLossPrice.toFixed(2),
        take_profit: takeProfitPrice.toFixed(2),
        sl_distance_pct: (((stopLossPrice - price) / price) * 100).toFixed(2),
        tp_distance_pct: (((price - takeProfitPrice) / price) * 100).toFixed(2),
        divergence_strength: divergence.bearishStrength.toFixed(2),
        confluences: 'downtrend+supply_zone+bearish_divergence+bearish_engulfing+rsi_below_ma'
      });

      signal.goShort();
      return;
    }

    // ── Log rejection reason ──────────────────────────────────────────────────
    if (isUptrend && !zoneResult.inDemandZone) {
      signal.debugAll({ long_rejected: 'not_in_demand_zone' });
    } else if (isUptrend && zoneResult.inDemandZone && !divergence.hasBullish) {
      signal.debugAll({ long_rejected: 'no_bullish_divergence' });
    } else if (isUptrend && zoneResult.inDemandZone && divergence.hasBullish && !engulfing.isBullishEngulfing) {
      signal.debugAll({ long_rejected: 'no_bullish_engulfing' });
    } else if (isUptrend && zoneResult.inDemandZone && divergence.hasBullish && engulfing.isBullishEngulfing && !rsiAboveMa) {
      signal.debugAll({ long_rejected: 'rsi_below_ma' });
    }

    if (isDowntrend && !zoneResult.inSupplyZone) {
      signal.debugAll({ short_rejected: 'not_in_supply_zone' });
    } else if (isDowntrend && zoneResult.inSupplyZone && !divergence.hasBearish) {
      signal.debugAll({ short_rejected: 'no_bearish_divergence' });
    } else if (isDowntrend && zoneResult.inSupplyZone && divergence.hasBearish && !engulfing.isBearishEngulfing) {
      signal.debugAll({ short_rejected: 'no_bearish_engulfing' });
    } else if (isDowntrend && zoneResult.inSupplyZone && divergence.hasBearish && engulfing.isBearishEngulfing && !rsiBelowMa) {
      signal.debugAll({ short_rejected: 'rsi_above_ma' });
    }
  }

  // ============== Helper Methods ==============

  /**
   * Detect Supply and Demand zones using pivot points.
   * Demand zone: area around recent Swing Low (price must be within ATR * multiplier)
   * Supply zone: area around recent Swing High (price must be within ATR * multiplier)
   */
  private detectZones(price: number, atr: number, pivotArr: (PivotPointResult | null)[]): ZoneResult {
    const threshold = atr * this.options.zone_atr_multiplier!;

    let nearestDemandLevel: number | null = null;
    let nearestSupplyLevel: number | null = null;
    let minDemandDist = Infinity;
    let minSupplyDist = Infinity;

    // Scan recent pivots (last 30 candles worth of pivots)
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

    // Price is "in zone" if within threshold distance AND price is approaching from the right direction
    // Demand zone: price is near or slightly above the swing low (price >= swingLow - threshold)
    const inDemandZone =
      nearestDemandLevel !== null &&
      price >= nearestDemandLevel - threshold &&
      price <= nearestDemandLevel + threshold * 3; // Allow some room above the zone

    // Supply zone: price is near or slightly below the swing high (price <= swingHigh + threshold)
    const inSupplyZone =
      nearestSupplyLevel !== null &&
      price <= nearestSupplyLevel + threshold &&
      price >= nearestSupplyLevel - threshold * 3; // Allow some room below the zone

    return {
      inDemandZone,
      inSupplyZone,
      nearestDemandLevel,
      nearestSupplyLevel
    };
  }

  /**
   * Detect RSI Divergence by comparing price swings vs RSI swings.
   *
   * Bullish Divergence: Price makes Lower Low but RSI makes Higher Low
   * Bearish Divergence: Price makes Higher High but RSI makes Lower High
   */
  private detectDivergence(prices: number[], rsiValues: number[], lookback: number): DivergenceResult {
    if (prices.length < 4 || rsiValues.length < 4) {
      return { hasBullish: false, hasBearish: false, bullishStrength: 0, bearishStrength: 0 };
    }

    const n = Math.min(prices.length, rsiValues.length, lookback + 2);
    const recentPrices = prices.slice(-n);
    const recentRsi = rsiValues.slice(-n);

    const currentPrice = recentPrices[recentPrices.length - 1];
    const currentRsi = recentRsi[recentRsi.length - 1];

    let hasBullish = false;
    let hasBearish = false;
    let bullishStrength = 0;
    let bearishStrength = 0;

    // Compare current candle with previous candles to find divergence
    // We look for the most significant divergence in the lookback window
    for (let i = 1; i < recentPrices.length - 1; i++) {
      const prevPrice = recentPrices[i];
      const prevRsi = recentRsi[i];

      // Bullish Divergence: current price lower than previous low, but RSI higher
      if (currentPrice < prevPrice && currentRsi > prevRsi) {
        const priceDrop = (prevPrice - currentPrice) / prevPrice; // How much price dropped
        const rsiRise = (currentRsi - prevRsi) / 100; // How much RSI rose (normalized)
        const strength = (priceDrop + rsiRise) / 2;

        if (strength > bullishStrength) {
          bullishStrength = strength;
          hasBullish = true;
        }
      }

      // Bearish Divergence: current price higher than previous high, but RSI lower
      if (currentPrice > prevPrice && currentRsi < prevRsi) {
        const priceRise = (currentPrice - prevPrice) / prevPrice; // How much price rose
        const rsiDrop = (prevRsi - currentRsi) / 100; // How much RSI dropped (normalized)
        const strength = (priceRise + rsiDrop) / 2;

        if (strength > bearishStrength) {
          bearishStrength = strength;
          hasBearish = true;
        }
      }
    }

    return { hasBullish, hasBearish, bullishStrength, bearishStrength };
  }

  /**
   * Detect Engulfing candlestick patterns.
   *
   * Bullish Engulfing: Current bullish candle body engulfs previous bearish candle body
   * Bearish Engulfing: Current bearish candle body engulfs previous bullish candle body
   */
  private detectEngulfing(candlesArr: any[]): EngulfingResult {
    if (candlesArr.length < 2) {
      return { isBullishEngulfing: false, isBearishEngulfing: false };
    }

    const current = candlesArr[candlesArr.length - 1];
    const previous = candlesArr[candlesArr.length - 2];

    if (!current || !previous) {
      return { isBullishEngulfing: false, isBearishEngulfing: false };
    }

    const currentOpen = current.open;
    const currentClose = current.close;
    const prevOpen = previous.open;
    const prevClose = previous.close;

    // Current candle is bullish (close > open)
    const currentBullish = currentClose > currentOpen;
    // Current candle is bearish (close < open)
    const currentBearish = currentClose < currentOpen;
    // Previous candle is bearish (close < open)
    const prevBearish = prevClose < prevOpen;
    // Previous candle is bullish (close > open)
    const prevBullish = prevClose > prevOpen;

    // Bullish Engulfing: previous bearish, current bullish, current body engulfs previous body
    const isBullishEngulfing =
      prevBearish &&
      currentBullish &&
      currentOpen <= prevClose && // Current open at or below previous close
      currentClose >= prevOpen; // Current close at or above previous open

    // Bearish Engulfing: previous bullish, current bearish, current body engulfs previous body
    const isBearishEngulfing =
      prevBullish &&
      currentBearish &&
      currentOpen >= prevClose && // Current open at or above previous close
      currentClose <= prevOpen; // Current close at or below previous open

    return { isBullishEngulfing, isBearishEngulfing };
  }

  /**
   * Calculate stop loss for long position.
   * SL = below the demand zone level (swing low) with ATR buffer
   */
  private calculateLongStopLoss(price: number, atr: number, demandLevel: number | null): number {
    if (this.options.stop_loss) {
      // Use fixed percentage if configured
      return price * (1 - this.options.stop_loss / 100);
    }

    if (demandLevel !== null) {
      // SL below the demand zone with ATR buffer
      return demandLevel - atr * this.options.atr_sl_multiplier!;
    }

    // Fallback: ATR-based SL
    return price - atr * 2;
  }

  /**
   * Calculate take profit for long position.
   * TP = entry + (entry - SL) * RR ratio
   */
  private calculateLongTakeProfit(price: number, stopLossPrice: number): number {
    if (this.options.take_profit) {
      // Use fixed percentage if configured
      return price * (1 + this.options.take_profit / 100);
    }

    const riskAmount = price - stopLossPrice;
    return price + riskAmount * this.options.rr_ratio!;
  }

  /**
   * Calculate stop loss for short position.
   * SL = above the supply zone level (swing high) with ATR buffer
   */
  private calculateShortStopLoss(price: number, atr: number, supplyLevel: number | null): number {
    if (this.options.stop_loss) {
      // Use fixed percentage if configured
      return price * (1 + this.options.stop_loss / 100);
    }

    if (supplyLevel !== null) {
      // SL above the supply zone with ATR buffer
      return supplyLevel + atr * this.options.atr_sl_multiplier!;
    }

    // Fallback: ATR-based SL
    return price + atr * 2;
  }

  /**
   * Calculate take profit for short position.
   * TP = entry - (SL - entry) * RR ratio
   */
  private calculateShortTakeProfit(price: number, stopLossPrice: number): number {
    if (this.options.take_profit) {
      // Use fixed percentage if configured
      return price * (1 - this.options.take_profit / 100);
    }

    const riskAmount = stopLossPrice - price;
    return price - riskAmount * this.options.rr_ratio!;
  }

  /**
   * Calculate SMA of RSI values (RSI-Based MA).
   * This is the "purple line" in the strategy — SMA applied to RSI, not price.
   * Returns null if not enough RSI data.
   */
  private calculateRsiMa(rsiArr: number[], period: number): number | null {
    if (rsiArr.length < period) {
      return null;
    }

    const slice = rsiArr.slice(-period);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / period;
  }

  protected getDefaultOptions(): SmcRsiDivergenceOptions {
    return {
      ema_fast_length: 50,
      ema_slow_length: 200,
      rsi_length: 14,
      rsi_ma_length: 14,
      atr_length: 14,
      pivot_left: 5,
      pivot_right: 3,
      divergence_lookback: 8,
      zone_atr_multiplier: 1.5,
      atr_sl_multiplier: 0.5,
      rr_ratio: 3
    };
  }
}
