import strategy, { StrategyBase, TypedStrategyContext, StrategySignal, type MacdResult, type TypedIndicatorDefinition } from '../strategy';

export interface MacdMa200AtrOptions {
  ema_length?: number;
  macd_fast?: number;
  macd_slow?: number;
  macd_signal?: number;
  atr_length?: number;
  atr_sl_multiplier?: number;
  atr_tp_multiplier?: number;
  allow_long?: boolean;
  allow_short?: boolean;
}

export type MacdMa200AtrIndicators = {
  ema200: TypedIndicatorDefinition<'ema'>;
  macd: TypedIndicatorDefinition<'macd'>;
  atr: TypedIndicatorDefinition<'atr'>;
};

export class MacdMa200Atr extends StrategyBase<MacdMa200AtrIndicators, MacdMa200AtrOptions> {
  private entryPrice?: number;
  private entryAtr?: number;

  getDescription(): string {
    return 'MACD line/signal cross with EMA200 trend filter and ATR-only exits';
  }

  defineIndicators(): MacdMa200AtrIndicators {
    return {
      ema200: strategy.indicator.ema({ length: this.options.ema_length }),
      macd: strategy.indicator.macd({
        fast_length: this.options.macd_fast,
        slow_length: this.options.macd_slow,
        signal_length: this.options.macd_signal
      }),
      atr: strategy.indicator.atr({ length: this.options.atr_length })
    };
  }

  async execute(context: TypedStrategyContext<MacdMa200AtrIndicators>, signal: StrategySignal): Promise<void> {
    const emaArr = (context.getIndicator('ema200') as (number | null)[]).filter(v => v !== null) as number[];
    const atrArr = (context.getIndicator('atr') as (number | null)[]).filter(v => v !== null) as number[];
    const macdArr = (context.getIndicator('macd') as (MacdResult | null)[]).filter(v => v !== null) as MacdResult[];

    if (emaArr.length < 1 || atrArr.length < 1 || macdArr.length < 2) {
      return;
    }

    if (context.isFlat()) {
      this.entryPrice = undefined;
      this.entryAtr = undefined;
    }

    const price = context.price;
    const ema200 = emaArr[emaArr.length - 1];
    const currentAtr = atrArr[atrArr.length - 1];
    const macdPrev = macdArr[macdArr.length - 2];
    const macdCurrent = macdArr[macdArr.length - 1];
    const bullishTrend = price > ema200;
    const bearishTrend = price < ema200;

    const goldenCross = macdPrev.macd <= macdPrev.signal && macdCurrent.macd > macdCurrent.signal;
    const deathCross = macdPrev.macd >= macdPrev.signal && macdCurrent.macd < macdCurrent.signal;
    const longBelowZero = macdCurrent.macd < 0 && macdCurrent.signal < 0;
    const shortAboveZero = macdCurrent.macd > 0 && macdCurrent.signal > 0;

    signal.debugAll({
      price: Number(price.toFixed(4)),
      ema200: Number(ema200.toFixed(4)),
      atr: Number(currentAtr.toFixed(4)),
      macd: Number(macdCurrent.macd.toFixed(6)),
      macd_signal: Number(macdCurrent.signal.toFixed(6)),
      macd_hist: Number(macdCurrent.histogram.toFixed(6)),
      golden_cross: goldenCross,
      death_cross: deathCross,
      bullish_trend: bullishTrend,
      bearish_trend: bearishTrend,
      long_below_zero: longBelowZero,
      short_above_zero: shortAboveZero
    });

    if (!context.isFlat()) {
      const exitReason = this.checkExit(context, price);
      if (exitReason) {
        signal.debugAll({ exit_reason: exitReason });
        signal.close();
        this.entryPrice = undefined;
        this.entryAtr = undefined;
      }
      return;
    }

    const longSetup = this.options.allow_long! && bullishTrend && goldenCross && longBelowZero;
    const shortSetup = this.options.allow_short! && bearishTrend && deathCross && shortAboveZero;

    signal.debugAll({
      long_setup_ready: longSetup,
      short_setup_ready: shortSetup
    });

    if (longSetup) {
      this.entryPrice = price;
      this.entryAtr = currentAtr;
      signal.goLong();
      return;
    }

    if (shortSetup) {
      this.entryPrice = price;
      this.entryAtr = currentAtr;
      signal.goShort();
    }
  }

  private checkExit(
    context: TypedStrategyContext<MacdMa200AtrIndicators>,
    price: number
  ): 'atr_stop_loss' | 'atr_take_profit' | undefined {
    if (this.entryPrice === undefined || this.entryAtr === undefined) {
      return undefined;
    }

    const slDistance = this.entryAtr * this.options.atr_sl_multiplier!;
    const tpDistance = this.entryAtr * this.options.atr_tp_multiplier!;

    if (context.isLong()) {
      if (price <= this.entryPrice - slDistance) return 'atr_stop_loss';
      if (price >= this.entryPrice + tpDistance) return 'atr_take_profit';
      return undefined;
    }

    if (context.isShort()) {
      if (price >= this.entryPrice + slDistance) return 'atr_stop_loss';
      if (price <= this.entryPrice - tpDistance) return 'atr_take_profit';
      return undefined;
    }

    return undefined;
  }

  protected getDefaultOptions(): MacdMa200AtrOptions {
    return {
      ema_length: 200,
      macd_fast: 12,
      macd_slow: 26,
      macd_signal: 9,
      atr_length: 14,
      atr_sl_multiplier: 1,
      atr_tp_multiplier: 1.5,
      allow_long: true,
      allow_short: true
    };
  }
}

export default MacdMa200Atr;
