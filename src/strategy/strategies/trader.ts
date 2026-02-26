/**
 * Improved Trader Strategy - Multi-indicator consensus system
 * 
 * Based on crypto-ta-analyzer patterns:
 * - Entry (Long): Bollinger Band Breakout + MACD Bullish + RSI < 70 + ADX > 20
 * - Entry (Short): Bollinger Band Breakdown + MACD Bearish + RSI > 30 + ADX > 20
 * - Exit: Reversal of MACD or RSI extremes
 */

import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type TypedIndicatorDefinition, type BollingerBandsResult, type MacdResult } from '../strategy';

// ============== Strategy Options ==============

export interface TraderOptions {
  bb_length?: number;
  bb_stddev?: number;
  rsi_length?: number;
  adx_length?: number;
  min_adx?: number;
  stop_loss?: number;
  take_profit?: number;
}

// ============== Indicator Definition ==============

export type TraderIndicators = {
  bb: TypedIndicatorDefinition<'bb'>;
  macd: TypedIndicatorDefinition<'macd'>;
  rsi: TypedIndicatorDefinition<'rsi'>;
  adx: TypedIndicatorDefinition<'adx'>;
  ema_fast: TypedIndicatorDefinition<'ema'>;
  ema_slow: TypedIndicatorDefinition<'ema'>;
};

// ============== Strategy Implementation ==============

export class Trader extends StrategyBase<TraderIndicators, TraderOptions> {
  getDescription(): string {
    return 'Improved multi-indicator trader using BB, MACD, RSI and ADX consensus.';
  }

  defineIndicators(): TraderIndicators {
    return {
      bb: strategy.indicator.bb({ length: this.options.bb_length, stddev: this.options.bb_stddev }),
      macd: strategy.indicator.macd({ fast_length: 12, slow_length: 26, signal_length: 9 }),
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length }),
      adx: strategy.indicator.adx({ length: this.options.adx_length }),
      ema_fast: strategy.indicator.ema({ length: 20 }),
      ema_slow: strategy.indicator.ema({ length: 50 }),
    };
  }

  async execute(context: TypedStrategyContext<TraderIndicators>, signal: StrategySignal): Promise<void> {
    const { price } = context;

    // Get current values
    const bb = context.getLatestIndicator('bb');
    const macd = context.getLatestIndicator('macd');
    const rsi = context.getLatestIndicator('rsi');
    const adx = context.getLatestIndicator('adx');
    const emaFast = context.getLatestIndicator('ema_fast');
    const emaSlow = context.getLatestIndicator('ema_slow');

    if (!bb || !macd || rsi === undefined || adx === undefined || emaFast === undefined || emaSlow === undefined) {
      return;
    }

    const isBullishTrend = emaFast > emaSlow;
    const isBearishTrend = emaFast < emaSlow;
    const isTrending = adx > this.options.min_adx!;

    // Debugging info for the UI
    signal.debugAll({
      rsi: Math.round(rsi * 100) / 100,
      adx: Math.round(adx * 100) / 100,
      macd_hist: Math.round(macd.histogram * 100) / 100,
      trend: isBullishTrend ? 'bullish' : 'bearish',
      bb_upper: Math.round(bb.upper * 100) / 100,
      bb_lower: Math.round(bb.lower * 100) / 100,
    });

    // --- EXIT LOGIC ---
    if (context.isLong()) {
      // Exit long if RSI is overbought and starts turning down, or price drops below BB middle
      if (rsi > 75 || price < bb.middle || (macd.histogram < 0 && isTrending)) {
        signal.close();
        return;
      }
    }

    if (context.isShort()) {
      // Exit short if RSI is oversold and starts turning up, or price rises above BB middle
      if (rsi < 25 || price > bb.middle || (macd.histogram > 0 && isTrending)) {
        signal.close();
        return;
      }
    }

    // --- ENTRY LOGIC ---
    // Only enter if we are currently flat
    if (context.isFlat()) {
      // Bullish Entry: Price > BB Upper + Bullish MACD + Not Overbought + Trending
      if (price > bb.upper && macd.histogram > 0 && rsi < 65 && isBullishTrend && isTrending) {
        signal.goLong();
      } 
      // Bearish Entry: Price < BB Lower + Bearish MACD + Not Oversold + Trending
      else if (price < bb.lower && macd.histogram < 0 && rsi > 35 && isBearishTrend && isTrending) {
        signal.goShort();
      }
    }
  }

  protected getDefaultOptions(): TraderOptions {
    return {
      bb_length: 20,
      bb_stddev: 2,
      rsi_length: 14,
      adx_length: 14,
      min_adx: 20,
      stop_loss: 3.0,
      take_profit: 6.0,
    };
  }
}
