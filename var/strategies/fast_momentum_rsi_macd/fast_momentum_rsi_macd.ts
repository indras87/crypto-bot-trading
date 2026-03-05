/**
 * Fast Momentum RSI + MACD Strategy
 *
 * Pure momentum continuation strategy:
 * - MACD histogram defines active momentum direction
 * - RSI catches fast pullback/retrace and trigger continuation re-entry
 * - Volume and cooldown filters reduce low-quality / revenge entries
 */

import strategy, { StrategyBase, StrategySignal, TypedStrategyContext, type MacdResult, type TypedIndicatorDefinition } from '../../../src/strategy/strategy';

export interface FastMomentumRsiMacdOptions {
  rsi_length?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  rsi_oversold?: number;
  rsi_overbought?: number;
  entry_rsi_long?: number;
  entry_rsi_short?: number;
  exit_rsi_long?: number;
  exit_rsi_short?: number;
  fixed_take_profit_pct?: number;
  emergency_stop_loss_pct?: number;
  cooldown_candles?: number;
  allow_long?: boolean;
  allow_short?: boolean;
}

export type FastMomentumRsiMacdIndicators = {
  rsi: TypedIndicatorDefinition<'rsi'>;
  macd: TypedIndicatorDefinition<'macd'>;
};

export class FastMomentumRsiMacd extends StrategyBase<FastMomentumRsiMacdIndicators, FastMomentumRsiMacdOptions> {
  private cooldownRemaining: number = 0;
  private entryPrice?: number;

  getDescription(): string {
    return 'Fast Momentum RSI + MACD continuation scalper (pure momentum, no EMA/BB)';
  }

  defineIndicators(): FastMomentumRsiMacdIndicators {
    return {
      rsi: strategy.indicator.rsi({ length: this.options.rsi_length }),
      macd: strategy.indicator.macd({
        fast_length: this.options.macd_fast,
        slow_length: this.options.macd_slow,
        signal_length: this.options.macd_signal
      })
    };
  }

  async execute(context: TypedStrategyContext<FastMomentumRsiMacdIndicators>, signal: StrategySignal): Promise<void> {
    const rsiArr = (context.getIndicator('rsi') as (number | null)[]).filter(v => v !== null) as number[];
    const macdArr = (context.getIndicator('macd') as (MacdResult | null)[]).filter(v => v !== null) as MacdResult[];

    if (rsiArr.length < 2 || macdArr.length < 1) {
      return;
    }

    if (context.isFlat() && this.entryPrice !== undefined) {
      this.entryPrice = undefined;
    }

    if (context.isFlat() && this.cooldownRemaining > 0) {
      this.cooldownRemaining -= 1;
    }

    const price = context.price;
    const rsiCurrent = rsiArr[rsiArr.length - 1];
    const rsiPrev = rsiArr[rsiArr.length - 2];
    const macdCurrent = macdArr[macdArr.length - 1];
    const hist = macdCurrent.histogram;
    const cooldownActive = this.cooldownRemaining > 0;
    const longEntryRsi = this.options.entry_rsi_long ?? this.options.rsi_overbought!;
    const shortEntryRsi = this.options.entry_rsi_short ?? this.options.rsi_oversold!;
    const longExitRsi = this.options.exit_rsi_long ?? this.options.rsi_oversold!;
    const shortExitRsi = this.options.exit_rsi_short ?? this.options.rsi_overbought!;
    const crossUpOverbought = rsiPrev < longEntryRsi && rsiCurrent >= longEntryRsi;
    const crossDownOversold = rsiPrev > shortEntryRsi && rsiCurrent <= shortEntryRsi;
    const macdDirectionOkLong = hist > 0;
    const macdDirectionOkShort = hist < 0;

    signal.debugAll({
      price: Number(price.toFixed(4)),
      rsi: Number(rsiCurrent.toFixed(2)),
      macd_hist: Number(hist.toFixed(6)),
      entry_rsi_long: longEntryRsi,
      entry_rsi_short: shortEntryRsi,
      exit_rsi_long: longExitRsi,
      exit_rsi_short: shortExitRsi,
      fixed_take_profit_pct: this.options.fixed_take_profit_pct,
      rsi_cross_up_overbought: crossUpOverbought,
      rsi_cross_down_oversold: crossDownOversold,
      macd_direction_ok_long: macdDirectionOkLong,
      macd_direction_ok_short: macdDirectionOkShort,
      emergency_stop_loss_pct: this.options.emergency_stop_loss_pct,
      cooldown_remaining: this.cooldownRemaining
    });

    if (!context.isFlat()) {
      const exitReason = this.checkExit(context, price);
      if (exitReason) {
        signal.debugAll({ exit_reason: exitReason });
        signal.close();
        this.entryPrice = undefined;
        this.cooldownRemaining = this.options.cooldown_candles!;
      }
      return;
    }

    const entryBlocked = cooldownActive;
    if (entryBlocked) {
      signal.debugAll({
        entry_blocked: true,
        blocked_by: [
          ...(cooldownActive ? ['cooldown'] : [])
        ].join('|')
      });
      return;
    }

    const longSetup = this.options.allow_long! &&
      crossUpOverbought &&
      macdDirectionOkLong;

    const shortSetup = this.options.allow_short! &&
      crossDownOversold &&
      macdDirectionOkShort;

    signal.debugAll({
      long_setup_ready: longSetup,
      short_setup_ready: shortSetup,
      rsi_cross_up_overbought: crossUpOverbought,
      rsi_cross_down_oversold: crossDownOversold
    });

    if (longSetup) {
      this.entryPrice = price;
      signal.goLong();
      return;
    }

    if (shortSetup) {
      this.entryPrice = price;
      signal.goShort();
    }
  }

  private checkExit(
    context: TypedStrategyContext<FastMomentumRsiMacdIndicators>,
    price: number
  ): string | undefined {
    const fixedTakeProfitPct = this.options.fixed_take_profit_pct || 0;
    const emergencyStopLossPct = this.options.emergency_stop_loss_pct || 0;

    if (context.isLong()) {
      if (emergencyStopLossPct > 0 && this.entryPrice !== undefined) {
        const stopPrice = this.entryPrice * (1 - emergencyStopLossPct / 100);
        if (price <= stopPrice) return 'emergency_stop_loss';
      }
      if (fixedTakeProfitPct > 0 && this.entryPrice !== undefined) {
        const targetPrice = this.entryPrice * (1 + fixedTakeProfitPct / 100);
        if (price >= targetPrice) return 'fixed_take_profit';
      }
      return undefined;
    }

    if (context.isShort()) {
      if (emergencyStopLossPct > 0 && this.entryPrice !== undefined) {
        const stopPrice = this.entryPrice * (1 + emergencyStopLossPct / 100);
        if (price >= stopPrice) return 'emergency_stop_loss';
      }
      if (fixedTakeProfitPct > 0 && this.entryPrice !== undefined) {
        const targetPrice = this.entryPrice * (1 - fixedTakeProfitPct / 100);
        if (price <= targetPrice) return 'fixed_take_profit';
      }
      return undefined;
    }

    return undefined;
  }

  protected getDefaultOptions(): FastMomentumRsiMacdOptions {
    return {
      rsi_length: 7,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      rsi_oversold: 30,
      rsi_overbought: 70,
      fixed_take_profit_pct: 2,
      emergency_stop_loss_pct: 9,
      cooldown_candles: 2,
      allow_long: true,
      allow_short: true
    };
  }
}

export default FastMomentumRsiMacd;
