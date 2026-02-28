/**
 * SMC + RSI Divergence Strategy
 *
 * Smart Money Concepts (SMC) combined with RSI Divergence for high-accuracy reversal entries.
 *
 * Core Concepts:
 * 1. Supply & Demand Zones: Identified via Pivot Points High/Low
 * 2. RSI Divergence: Detects momentum weakness before entry
 * 3. Trend Filter: EMA fast vs EMA slow as trend proxy
 * 4. Candle Confirmation: Bullish/Bearish candle (or optional Engulfing)
 * 5. RSI Based MA: RSI vs its own SMA as momentum filter
 *
 * Entry Logic:
 * LONG: Uptrend (EMA fast > EMA slow) + Price near Demand Zone + Bullish RSI Divergence
 *       + Bullish candle confirmation + RSI > RSI-MA
 * SHORT: Downtrend (EMA fast < EMA slow) + Price near Supply Zone + Bearish RSI Divergence
 *        + Bearish candle confirmation + RSI < RSI-MA
 *
 * Exit Logic:
 * - Auto close when trend reverses (EMA cross)
 * - SL/TP calculated via ATR (stop_loss / take_profit options in percent)
 *
 * Recommended Timeframes: 5m, 15m, 30m, 1h
 * Risk:Reward: Configurable (default 2:1)
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition, type PivotPointResult } from '../../strategy';

// ============== Strategy Options ==============

export interface SmcRsiDivergenceOptions {
  /** EMA fast period for trend detection */
  ema_fast_length?: number;
  /** EMA slow period for trend detection */
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
  /** Zone proximity threshold as multiplier of ATR */
  zone_atr_multiplier?: number;
  /** ATR multiplier for stop loss buffer below/above swing */
  atr_sl_multiplier?: number;
  /** Risk:Reward ratio for take profit calculation */
  rr_ratio?: number;
  /** Stop loss percent (overrides ATR-based SL if set) */
  stop_loss?: number;
  /** Take profit percent (overrides RR-based TP if set) */
  take_profit?: number;
  /**
   * Require strict Engulfing pattern for entry confirmation.
   * false (default): only requires bullish/bearish candle direction
   * true: requires full engulfing pattern (more selective)
   */
  require_engulfing?: boolean;
  /**
   * Minimum divergence strength (0-1) to trigger entry.
   * Lower = more signals, higher = more selective.
   * Default: 0.001 (very permissive)
   */
  min_divergence_strength?: number;
  /**
   * Require RSI-MA filter (RSI above/below its own SMA).
   * true (default): RSI must be above/below RSI-MA
   * false: skip RSI-MA filter for more signals
   */
  require_rsi_ma?: boolean;
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
  bullishStrength: number;
  bearishStrength: number;
}

interface ZoneResult {
  inDemandZone: boolean;
  inSupplyZone: boolean;
  nearestDemandLevel: number | null;
  nearestSupplyLevel: number | null;
}

interface CandleConfirmResult {
  isBullish: boolean;
  isBearish: boolean;
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
    const minRsiData = Math.max(this.options.divergence_lookback!, rsiMaPeriod);

    if (
      emaFastArr.length < 5 ||
      emaSlowArr.length < 5 ||
      rsiArr.length < minRsiData ||
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

    // ── Candle Confirmation ───────────────────────────────────────────────────
    const candleConfirm = this.detectCandleConfirmation(candlesArr);

    // ── RSI Based MA Filter ───────────────────────────────────────────────────
    const rsiAboveMa = rsi > rsiMa;
    const rsiBelowMa = rsi < rsiMa;

    // ── Determine confirmation based on options ───────────────────────────────
    const requireEngulfing = this.options.require_engulfing ?? false;
    const requireRsiMa = this.options.require_rsi_ma ?? true;
    const minDivStrength = this.options.min_divergence_strength ?? 0.001;

    const longCandleOk = requireEngulfing ? candleConfirm.isBullishEngulfing : candleConfirm.isBullish;
    const shortCandleOk = requireEngulfing ? candleConfirm.isBearishEngulfing : candleConfirm.isBearish;
    const longRsiMaOk = requireRsiMa ? rsiAboveMa : true;
    const shortRsiMaOk = requireRsiMa ? rsiBelowMa : true;

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
      div_bull_strength: divergence.bullishStrength.toFixed(4),
      div_bear_strength: divergence.bearishStrength.toFixed(4),
      bullish_candle: candleConfirm.isBullish,
      bearish_candle: candleConfirm.isBearish,
      bullish_engulfing: candleConfirm.isBullishEngulfing,
      bearish_engulfing: candleConfirm.isBearishEngulfing
    });

    // ── LONG Entry ────────────────────────────────────────────────────────────
    if (
      isUptrend &&
      zoneResult.inDemandZone &&
      divergence.hasBullish &&
      divergence.bullishStrength >= minDivStrength &&
      longCandleOk &&
      longRsiMaOk
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
        divergence_strength: divergence.bullishStrength.toFixed(4),
        confluences: `uptrend+demand_zone+bullish_divergence+${requireEngulfing ? 'engulfing' : 'bullish_candle'}${requireRsiMa ? '+rsi_above_ma' : ''}`
      });

      signal.goLong();
      return;
    }

    // ── SHORT Entry ───────────────────────────────────────────────────────────
    if (
      isDowntrend &&
      zoneResult.inSupplyZone &&
      divergence.hasBearish &&
      divergence.bearishStrength >= minDivStrength &&
      shortCandleOk &&
      shortRsiMaOk
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
        divergence_strength: divergence.bearishStrength.toFixed(4),
        confluences: `downtrend+supply_zone+bearish_divergence+${requireEngulfing ? 'engulfing' : 'bearish_candle'}${requireRsiMa ? '+rsi_below_ma' : ''}`
      });

      signal.goShort();
      return;
    }

    // ── Log rejection reason ──────────────────────────────────────────────────
    if (isUptrend) {
      if (!zoneResult.inDemandZone) {
        signal.debugAll({ long_rejected: 'not_in_demand_zone' });
      } else if (!divergence.hasBullish || divergence.bullishStrength < minDivStrength) {
        signal.debugAll({ long_rejected: `no_bullish_divergence (strength=${divergence.bullishStrength.toFixed(4)})` });
      } else if (!longCandleOk) {
        signal.debugAll({ long_rejected: requireEngulfing ? 'no_bullish_engulfing' : 'no_bullish_candle' });
      } else if (!longRsiMaOk) {
        signal.debugAll({ long_rejected: 'rsi_below_ma' });
      }
    }

    if (isDowntrend) {
      if (!zoneResult.inSupplyZone) {
        signal.debugAll({ short_rejected: 'not_in_supply_zone' });
      } else if (!divergence.hasBearish || divergence.bearishStrength < minDivStrength) {
        signal.debugAll({ short_rejected: `no_bearish_divergence (strength=${divergence.bearishStrength.toFixed(4)})` });
      } else if (!shortCandleOk) {
        signal.debugAll({ short_rejected: requireEngulfing ? 'no_bearish_engulfing' : 'no_bearish_candle' });
      } else if (!shortRsiMaOk) {
        signal.debugAll({ short_rejected: 'rsi_above_ma' });
      }
    }
  }

  // ============== Helper Methods ==============

  /**
   * Detect Supply and Demand zones using pivot points.
   * Demand zone: area around recent Swing Low
   * Supply zone: area around recent Swing High
   */
  private detectZones(price: number, atr: number, pivotArr: (PivotPointResult | null)[]): ZoneResult {
    const threshold = atr * this.options.zone_atr_multiplier!;

    let nearestDemandLevel: number | null = null;
    let nearestSupplyLevel: number | null = null;
    let minDemandDist = Infinity;
    let minSupplyDist = Infinity;

    // Scan recent pivots (last 50 candles worth of pivots)
    const recentPivots = pivotArr.slice(-50);

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

    // Price is "in zone" if within threshold distance
    // Demand zone: price is near or slightly above the swing low
    const inDemandZone =
      nearestDemandLevel !== null &&
      price >= nearestDemandLevel - threshold &&
      price <= nearestDemandLevel + threshold * 4;

    // Supply zone: price is near or slightly below the swing high
    const inSupplyZone =
      nearestSupplyLevel !== null &&
      price <= nearestSupplyLevel + threshold &&
      price >= nearestSupplyLevel - threshold * 4;

    return {
      inDemandZone,
      inSupplyZone,
      nearestDemandLevel,
      nearestSupplyLevel
    };
  }

  /**
   * Detect RSI Divergence.
   *
   * Compares current candle against each previous candle in the lookback window.
   * Finds the most significant divergence.
   *
   * Bullish Divergence: Current price LOWER than a previous price (Lower Low),
   *                     but current RSI HIGHER than RSI at that previous point (Higher Low)
   *
   * Bearish Divergence: Current price HIGHER than a previous price (Higher High),
   *                     but current RSI LOWER than RSI at that previous point (Lower High)
   */
  private detectDivergence(prices: number[], rsiValues: number[], lookback: number): DivergenceResult {
    if (prices.length < 3 || rsiValues.length < 3) {
      return { hasBullish: false, hasBearish: false, bullishStrength: 0, bearishStrength: 0 };
    }

    const n = Math.min(prices.length, rsiValues.length, lookback + 1);
    const recentPrices = prices.slice(-n);
    const recentRsi = rsiValues.slice(-n);

    // Current candle is the LAST element
    const currentPrice = recentPrices[recentPrices.length - 1];
    const currentRsi = recentRsi[recentRsi.length - 1];

    let hasBullish = false;
    let hasBearish = false;
    let bullishStrength = 0;
    let bearishStrength = 0;

    // Compare current candle against each previous candle in the window
    // Skip the last element (current candle) and the very first (too old)
    for (let i = 0; i < recentPrices.length - 1; i++) {
      const prevPrice = recentPrices[i];
      const prevRsi = recentRsi[i];

      // Bullish Divergence: current price LOWER than previous (Lower Low)
      //                     but current RSI HIGHER than previous RSI (Higher Low)
      if (currentPrice < prevPrice && currentRsi > prevRsi) {
        const priceDrop = prevPrice > 0 ? (prevPrice - currentPrice) / prevPrice : 0;
        const rsiRise = (currentRsi - prevRsi) / 100;
        const strength = priceDrop + rsiRise;

        if (strength > bullishStrength) {
          bullishStrength = strength;
          hasBullish = true;
        }
      }

      // Bearish Divergence: current price HIGHER than previous (Higher High)
      //                     but current RSI LOWER than previous RSI (Lower High)
      if (currentPrice > prevPrice && currentRsi < prevRsi) {
        const priceRise = prevPrice > 0 ? (currentPrice - prevPrice) / prevPrice : 0;
        const rsiDrop = (prevRsi - currentRsi) / 100;
        const strength = priceRise + rsiDrop;

        if (strength > bearishStrength) {
          bearishStrength = strength;
          hasBearish = true;
        }
      }
    }

    return { hasBullish, hasBearish, bullishStrength, bearishStrength };
  }

  /**
   * Detect candle confirmation patterns.
   * Returns both simple direction and engulfing pattern.
   */
  private detectCandleConfirmation(candlesArr: any[]): CandleConfirmResult {
    if (candlesArr.length < 2) {
      return { isBullish: false, isBearish: false, isBullishEngulfing: false, isBearishEngulfing: false };
    }

    const current = candlesArr[candlesArr.length - 1];
    const previous = candlesArr[candlesArr.length - 2];

    if (!current || !previous) {
      return { isBullish: false, isBearish: false, isBullishEngulfing: false, isBearishEngulfing: false };
    }

    const currentOpen = current.open;
    const currentClose = current.close;
    const prevOpen = previous.open;
    const prevClose = previous.close;

    // Simple direction
    const isBullish = currentClose > currentOpen;
    const isBearish = currentClose < currentOpen;

    // Previous candle direction
    const prevBearish = prevClose < prevOpen;
    const prevBullish = prevClose > prevOpen;

    // Engulfing patterns
    const isBullishEngulfing =
      prevBearish &&
      isBullish &&
      currentOpen <= prevClose &&
      currentClose >= prevOpen;

    const isBearishEngulfing =
      prevBullish &&
      isBearish &&
      currentOpen >= prevClose &&
      currentClose <= prevOpen;

    return { isBullish, isBearish, isBullishEngulfing, isBearishEngulfing };
  }

  /**
   * Calculate SMA of RSI values (RSI-Based MA).
   */
  private calculateRsiMa(rsiArr: number[], period: number): number | null {
    if (rsiArr.length < period) {
      return null;
    }

    const slice = rsiArr.slice(-period);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    return sum / period;
  }

  /**
   * Calculate stop loss for long position.
   */
  private calculateLongStopLoss(price: number, atr: number, demandLevel: number | null): number {
    if (this.options.stop_loss) {
      return price * (1 - this.options.stop_loss / 100);
    }

    if (demandLevel !== null) {
      return demandLevel - atr * this.options.atr_sl_multiplier!;
    }

    return price - atr * 2;
  }

  /**
   * Calculate take profit for long position.
   */
  private calculateLongTakeProfit(price: number, stopLossPrice: number): number {
    if (this.options.take_profit) {
      return price * (1 + this.options.take_profit / 100);
    }

    const riskAmount = price - stopLossPrice;
    return price + riskAmount * this.options.rr_ratio!;
  }

  /**
   * Calculate stop loss for short position.
   */
  private calculateShortStopLoss(price: number, atr: number, supplyLevel: number | null): number {
    if (this.options.stop_loss) {
      return price * (1 + this.options.stop_loss / 100);
    }

    if (supplyLevel !== null) {
      return supplyLevel + atr * this.options.atr_sl_multiplier!;
    }

    return price + atr * 2;
  }

  /**
   * Calculate take profit for short position.
   */
  private calculateShortTakeProfit(price: number, stopLossPrice: number): number {
    if (this.options.take_profit) {
      return price * (1 - this.options.take_profit / 100);
    }

    const riskAmount = stopLossPrice - price;
    return price - riskAmount * this.options.rr_ratio!;
  }

  protected getDefaultOptions(): SmcRsiDivergenceOptions {
    return {
      ema_fast_length: 21,
      ema_slow_length: 50,
      rsi_length: 14,
      rsi_ma_length: 9,
      atr_length: 14,
      pivot_left: 3,
      pivot_right: 2,
      divergence_lookback: 8,
      zone_atr_multiplier: 2.5,
      atr_sl_multiplier: 0.8,
      rr_ratio: 2,
      require_engulfing: false,
      min_divergence_strength: 0.001,
      require_rsi_ma: true
    };
  }
}
