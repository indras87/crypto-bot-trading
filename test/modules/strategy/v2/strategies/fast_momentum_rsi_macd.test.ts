import assert from 'assert';
import fs from 'fs';
import * as path from 'path';
import { StrategyRegistry } from '../../../../../src/modules/strategy/v2/strategy_registry';
import { StrategyExecutor } from '../../../../../src/modules/strategy/v2/typed_backtest';
import { Candlestick } from '../../../../../src/dict/candlestick';
import { StrategySignal, TypedStrategyContext, type MacdResult } from '../../../../../src/strategy/strategy';
import { FastMomentumRsiMacd } from '../../../../../var/strategies/fast_momentum_rsi_macd/fast_momentum_rsi_macd';

interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function createCandleFixtures(): RawCandle[] {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/btc-usdt-15m.json'), 'utf8'));
}

function toCandlestickInstances(candles: RawCandle[]): Candlestick[] {
  return candles.map(c => new Candlestick(c.time, c.open, c.high, c.low, c.close, c.volume));
}

function toAscOrder(candles: Candlestick[]): Candlestick[] {
  return candles.slice().reverse();
}

function createContext(
  price: number,
  rsi: number[],
  macdHist: number[],
  candles: Candlestick[],
  lastSignal: 'long' | 'short' | 'close' | undefined
): TypedStrategyContext<any> {
  const macd: MacdResult[] = macdHist.map(histogram => ({
    macd: histogram,
    signal: 0,
    histogram
  }));

  return new TypedStrategyContext<any>(
    price,
    {
      rsi,
      macd
    },
    lastSignal,
    candles.map(c => c.close)
  );
}

function buildCandles(closes: number[], volumes: number[] = []): Candlestick[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close - 0.1 : closes[i - 1];
    const high = Math.max(open, close) + 0.3;
    const low = Math.min(open, close) - 0.3;
    const volume = volumes[i] ?? 100;
    return new Candlestick(1_700_000_000 + i * 60, open, high, low, close, volume);
  });
}

describe('#FastMomentumRsiMacd (Dynamic)', () => {
  let candlesAsc: Candlestick[];
  let candlesDesc: Candlestick[];
  let registry: StrategyRegistry;
  let executor: StrategyExecutor;

  beforeEach(() => {
    const raw = createCandleFixtures();
    candlesDesc = toCandlestickInstances(raw);
    candlesAsc = toAscOrder(candlesDesc);
    registry = new StrategyRegistry();
    executor = new StrategyExecutor({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  describe('dynamic loading', () => {
    it('validates strategy from var/strategies directory', () => {
      assert.equal(registry.isValidStrategy('fast_momentum_rsi_macd'), true);
    });

    it('creates strategy instance via registry', () => {
      const instance = registry.createStrategy('fast_momentum_rsi_macd', {});
      assert.equal(instance.getDescription(), 'Fast Momentum RSI + MACD continuation scalper (pure momentum, no EMA/BB)');
    });
  });

  describe('strategy initialization', () => {
    it('creates strategy with default options', () => {
      const strategy = new FastMomentumRsiMacd();
      const options = strategy.getOptions();

      assert.equal(options.rsi_length, 7);
      assert.equal(options.macd_fast, 12);
      assert.equal(options.macd_slow, 26);
      assert.equal(options.macd_signal, 9);
      assert.equal(options.rsi_oversold, 30);
      assert.equal(options.rsi_overbought, 70);
      assert.equal(options.fixed_take_profit_pct, 2);
      assert.equal(options.emergency_stop_loss_pct, 9);
      assert.equal(options.cooldown_candles, 2);
    });

    it('defines RSI and MACD indicators only', () => {
      const strategy = new FastMomentumRsiMacd();
      const indicators = strategy.defineIndicators();

      assert.equal(indicators.rsi.name, 'rsi');
      assert.equal(indicators.macd.name, 'macd');
      assert.equal(Object.keys(indicators).length, 2);
    });
  });

  describe('signal generation via executor', () => {
    it('generates only valid signal types on fixture', async () => {
      const instance = registry.createStrategy('fast_momentum_rsi_macd', {});
      const results = await executor.execute(instance, candlesAsc);
      const signals = results.filter(r => r.signal !== undefined);

      for (const row of signals) {
        assert.equal(['long', 'short', 'close'].includes(row.signal!), true);
      }
    });

    it('throws error when candles are in descending order', async () => {
      const instance = registry.createStrategy('fast_momentum_rsi_macd', {});

      try {
        await executor.execute(instance, candlesDesc);
        assert.fail('Should have thrown an error');
      } catch (error: any) {
        assert.equal(error.message.includes('ascending order'), true);
      }
    });
  });

  describe('rule behavior with controlled context', () => {
    it('triggers long on RSI cross up to overbought with positive MACD histogram', async () => {
      const strategy = new FastMomentumRsiMacd();
      const candles = buildCandles([100.4, 100, 99.8, 99.6, 100.2], [100, 100, 100, 100, 160]);
      const context = createContext(100.2, [66, 71], [0.2], candles, undefined);
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, 'long');
      assert.equal(signal.getDebug().long_setup_ready, true);
    });

    it('triggers short on RSI cross down to oversold with negative MACD histogram', async () => {
      const strategy = new FastMomentumRsiMacd();
      const candles = buildCandles([99.7, 100, 100.3, 100.7, 100.1], [100, 100, 100, 100, 160]);
      const context = createContext(100.1, [34, 29], [-0.2], candles, undefined);
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, 'short');
      assert.equal(signal.getDebug().short_setup_ready, true);
    });

    it('rejects long entry when MACD direction is not bullish', async () => {
      const strategy = new FastMomentumRsiMacd();
      const candles = buildCandles([100.4, 100, 99.8, 99.6, 100.2], [100, 100, 100, 100, 160]);
      const context = createContext(100.2, [66, 71], [-0.2], candles, undefined);
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, undefined);
      assert.equal(signal.getDebug().macd_direction_ok_long, false);
    });

    it('blocks entry when cooldown is active', async () => {
      const strategy = new FastMomentumRsiMacd({
        cooldown_candles: 2
      });

      // 1) Open long
      const candles1 = buildCandles([100.4, 100, 99.9, 99.7, 100.3], [100, 100, 100, 100, 170]);
      const openContext = createContext(100.3, [68, 71], [0.22], candles1, undefined);
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'long');

      // 2) Exit long by fixed TP +2%
      const candles2 = buildCandles([100.8, 101.2, 101.6, 102.0, 102.4], [100, 100, 100, 100, 150]);
      const closeContext = createContext(102.4, [61, 63], [0.1], candles2, 'long');
      const closeSignal = new StrategySignal();
      await strategy.execute(closeContext, closeSignal);
      assert.equal(closeSignal.signal, 'close');
      assert.equal(closeSignal.getDebug().exit_reason, 'fixed_take_profit');

      // 3) Immediate next candle still blocked by cooldown.
      const candles3 = buildCandles([99.6, 99.8, 100, 100.2, 100.4], [100, 100, 100, 100, 170]);
      const blockedContext = createContext(100.4, [69, 72], [0.2], candles3, 'close');
      const blockedSignal = new StrategySignal();
      await strategy.execute(blockedContext, blockedSignal);
      assert.equal(blockedSignal.signal, undefined);
      assert.equal(blockedSignal.getDebug().entry_blocked, true);
      assert.equal((blockedSignal.getDebug().blocked_by as string).includes('cooldown'), true);

      // 4) Next candle after cooldown expires can re-enter
      const candles4 = buildCandles([100.0, 100.2, 100.4, 100.6, 100.8], [100, 100, 100, 100, 180]);
      const reentryContext = createContext(100.8, [68, 71], [0.2], candles4, undefined);
      const reentrySignal = new StrategySignal();
      await strategy.execute(reentryContext, reentrySignal);
      assert.equal(reentrySignal.signal, 'long');
    });

    it('closes short by fixed take profit when price moves down 2%', async () => {
      const strategy = new FastMomentumRsiMacd();

      const openCandles = buildCandles([100.8, 100.6, 100.4, 100.2, 100.0], [100, 100, 100, 100, 100]);
      const openContext = createContext(100.0, [33, 29], [-0.2], openCandles, undefined);
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'short');

      const exitCandles = buildCandles([99.9, 99.4, 99.0, 98.5, 97.9], [100, 100, 100, 100, 100]);
      const exitContext = createContext(97.9, [42, 38], [-0.05], exitCandles, 'short');
      const exitSignal = new StrategySignal();
      await strategy.execute(exitContext, exitSignal);

      assert.equal(exitSignal.signal, 'close');
      assert.equal(exitSignal.getDebug().exit_reason, 'fixed_take_profit');
    });

    it('closes long by emergency stop loss when enabled', async () => {
      const strategy = new FastMomentumRsiMacd({
        emergency_stop_loss_pct: 1.0,
        cooldown_candles: 1
      });

      const openCandles = buildCandles([100.0, 100.2, 100.4, 100.6, 100.8], [100, 100, 100, 100, 100]);
      const openContext = createContext(100.8, [68, 71], [0.2], openCandles, undefined);
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'long');

      // Price drops > 1% from entry (100.8 -> <= 99.792), while RSI has not reached 30 yet.
      const stopCandles = buildCandles([100.5, 100.2, 100.0, 99.8, 99.7], [100, 100, 100, 100, 100]);
      const stopContext = createContext(99.7, [46, 43], [0.05], stopCandles, 'long');
      const stopSignal = new StrategySignal();
      await strategy.execute(stopContext, stopSignal);

      assert.equal(stopSignal.signal, 'close');
      assert.equal(stopSignal.getDebug().exit_reason, 'emergency_stop_loss');
    });
  });
});
