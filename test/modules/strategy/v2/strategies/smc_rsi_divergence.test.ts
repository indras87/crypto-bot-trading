import assert from 'assert';
import fs from 'fs';
import * as path from 'path';
import { SmcRsiDivergence } from '../../../../../src/strategy/strategies/smc_rsi_divergence/smc_rsi_divergence';
import { StrategyExecutor } from '../../../../../src/modules/strategy/v2/typed_backtest';
import { Candlestick } from '../../../../../src/dict/candlestick';

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

describe('#SmcRsiDivergence', () => {
  let candlesAsc: Candlestick[];
  let executor: StrategyExecutor;

  beforeEach(() => {
    const rawCandles = createCandleFixtures();
    candlesAsc = toAscOrder(toCandlestickInstances(rawCandles));
    executor = new StrategyExecutor({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  describe('strategy initialization', () => {
    it('creates strategy with default options', () => {
      const s = new SmcRsiDivergence();
      assert.equal(s.getDescription(), 'SMC + RSI Divergence - Smart Money Concepts with RSI divergence for reversal entries');

      const opts = s.getOptions();
      assert.equal(opts.ema_fast_length, 21);
      assert.equal(opts.ema_slow_length, 50);
      assert.equal(opts.rsi_length, 14);
      assert.equal(opts.rsi_ma_length, 9);
      assert.equal(opts.atr_length, 14);
      assert.equal(opts.pivot_left, 3);
      assert.equal(opts.pivot_right, 2);
      assert.equal(opts.divergence_lookback, 8);
      assert.equal(opts.zone_atr_multiplier, 2.5);
      assert.equal(opts.atr_sl_multiplier, 0.8);
      assert.equal(opts.rr_ratio, 2);
      assert.equal(opts.require_engulfing, false);
      assert.equal(opts.min_divergence_strength, 0.001);
      assert.equal(opts.require_rsi_ma, true);
    });

    it('creates strategy with custom options', () => {
      const s = new SmcRsiDivergence({
        ema_fast_length: 9,
        ema_slow_length: 21,
        rsi_length: 7,
        rr_ratio: 1.5,
        require_engulfing: true,
        require_rsi_ma: false
      });

      const opts = s.getOptions();
      assert.equal(opts.ema_fast_length, 9);
      assert.equal(opts.ema_slow_length, 21);
      assert.equal(opts.rsi_length, 7);
      assert.equal(opts.rr_ratio, 1.5);
      assert.equal(opts.require_engulfing, true);
      assert.equal(opts.require_rsi_ma, false);
      // Defaults preserved
      assert.equal(opts.rsi_ma_length, 9);
      assert.equal(opts.atr_length, 14);
    });

    it('defines all required indicators', () => {
      const s = new SmcRsiDivergence();
      const indicators = s.defineIndicators();

      assert.equal(indicators.ema_fast.name, 'ema');
      assert.equal(indicators.ema_slow.name, 'ema');
      assert.equal(indicators.rsi.name, 'rsi');
      assert.equal(indicators.atr.name, 'atr');
      assert.equal(indicators.pivot_points.name, 'pivot_points_high_low');
      assert.equal(indicators.candles.name, 'candles');
    });

    it('uses correct indicator options', () => {
      const s = new SmcRsiDivergence({
        ema_fast_length: 21,
        ema_slow_length: 100,
        rsi_length: 21,
        atr_length: 21,
        pivot_left: 8,
        pivot_right: 5
      });
      const indicators = s.defineIndicators();

      assert.equal(indicators.ema_fast.options.length, 21);
      assert.equal(indicators.ema_slow.options.length, 100);
      assert.equal(indicators.rsi.options.length, 21);
      assert.equal(indicators.atr.options.length, 21);
      assert.equal(indicators.pivot_points.options.left, 8);
      assert.equal(indicators.pivot_points.options.right, 5);
    });
  });

  describe('signal generation', () => {
    it('generates only valid signals on fixture data', async () => {
      const s = new SmcRsiDivergence();
      const results = await executor.execute(s, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      console.log(`    SmcRsiDivergence: ${signals.length} signals from ${results.length} candles`);

      for (const sig of signals) {
        assert.equal(
          ['long', 'short', 'close'].includes(sig.signal!),
          true,
          `Invalid signal: ${sig.signal}`
        );
      }
    });

    it('does not generate signals before sufficient data is available', async () => {
      const s = new SmcRsiDivergence();
      // Use only first 50 candles (not enough for EMA 200)
      const shortCandles = candlesAsc.slice(0, 50);
      const results = await executor.execute(s, shortCandles);

      const entrySignals = results.filter(r => r.signal === 'long' || r.signal === 'short');
      assert.equal(entrySignals.length, 0, 'Should not generate entry signals with insufficient data');
    });

    it('generates debug output for all candles', async () => {
      const s = new SmcRsiDivergence();
      const results = await executor.execute(s, candlesAsc);

      // After sufficient data, debug should contain trend info
      const resultsWithDebug = results.filter(r => r.debug && r.debug.trend !== undefined);
      assert.ok(resultsWithDebug.length > 0, 'Should have debug output with trend info');
    });

    it('close signals follow long or short signals', async () => {
      const s = new SmcRsiDivergence();
      const results = await executor.execute(s, candlesAsc);

      let lastEntrySignal: string | undefined;
      for (const row of results) {
        if (row.signal === 'long' || row.signal === 'short') {
          lastEntrySignal = row.signal;
        } else if (row.signal === 'close') {
          assert.ok(lastEntrySignal !== undefined, 'Close signal should follow an entry signal');
          lastEntrySignal = undefined;
        }
      }
    });

    it('respects single entry per zone (no consecutive same-direction entries)', async () => {
      const s = new SmcRsiDivergence();
      const results = await executor.execute(s, candlesAsc);

      let inLong = false;
      let inShort = false;

      for (const row of results) {
        if (row.signal === 'long') {
          assert.equal(inLong, false, 'Should not enter long when already in long');
          assert.equal(inShort, false, 'Should not enter long when in short');
          inLong = true;
        } else if (row.signal === 'short') {
          assert.equal(inShort, false, 'Should not enter short when already in short');
          assert.equal(inLong, false, 'Should not enter short when in long');
          inShort = true;
        } else if (row.signal === 'close') {
          inLong = false;
          inShort = false;
        }
      }
    });
  });

  describe('custom options behavior', () => {
    it('works with tighter zone threshold', async () => {
      const s = new SmcRsiDivergence({ zone_atr_multiplier: 0.5 });
      const results = await executor.execute(s, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      // Tighter zone = fewer signals (or same)
      console.log(`    SmcRsiDivergence (tight zone): ${signals.length} signals`);

      for (const sig of signals) {
        assert.equal(['long', 'short', 'close'].includes(sig.signal!), true);
      }
    });

    it('works with wider zone threshold', async () => {
      const s = new SmcRsiDivergence({ zone_atr_multiplier: 3.0 });
      const results = await executor.execute(s, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      // Wider zone = more potential signals
      console.log(`    SmcRsiDivergence (wide zone): ${signals.length} signals`);

      for (const sig of signals) {
        assert.equal(['long', 'short', 'close'].includes(sig.signal!), true);
      }
    });

    it('works with shorter EMA periods', async () => {
      const s = new SmcRsiDivergence({
        ema_fast_length: 20,
        ema_slow_length: 50
      });
      const results = await executor.execute(s, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      console.log(`    SmcRsiDivergence (short EMA): ${signals.length} signals`);

      for (const sig of signals) {
        assert.equal(['long', 'short', 'close'].includes(sig.signal!), true);
      }
    });

    it('works with fixed stop_loss and take_profit options', async () => {
      const s = new SmcRsiDivergence({
        stop_loss: 2.0,
        take_profit: 6.0
      });
      const results = await executor.execute(s, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      console.log(`    SmcRsiDivergence (fixed SL/TP): ${signals.length} signals`);

      for (const sig of signals) {
        assert.equal(['long', 'short', 'close'].includes(sig.signal!), true);
      }
    });
  });

  describe('debug output validation', () => {
    it('long signal debug contains required fields', async () => {
      const s = new SmcRsiDivergence({ zone_atr_multiplier: 5.0, divergence_lookback: 3 });
      const results = await executor.execute(s, candlesAsc);

      const longSignals = results.filter(r => r.signal === 'long');
      if (longSignals.length > 0) {
        const debug = longSignals[0].debug;
        assert.ok(debug.ema_fast !== undefined, 'Should have ema_fast in debug');
        assert.ok(debug.ema_slow !== undefined, 'Should have ema_slow in debug');
        assert.ok(debug.rsi !== undefined, 'Should have rsi in debug');
        assert.ok(debug.signal === 'LONG', 'Should have signal=LONG in debug');
        assert.ok(debug.entry_price !== undefined, 'Should have entry_price in debug');
        assert.ok(debug.stop_loss !== undefined, 'Should have stop_loss in debug');
        assert.ok(debug.take_profit !== undefined, 'Should have take_profit in debug');
        assert.ok(debug.confluences !== undefined, 'Should have confluences in debug');
      }
    });

    it('short signal debug contains required fields', async () => {
      const s = new SmcRsiDivergence({ zone_atr_multiplier: 5.0, divergence_lookback: 3 });
      const results = await executor.execute(s, candlesAsc);

      const shortSignals = results.filter(r => r.signal === 'short');
      if (shortSignals.length > 0) {
        const debug = shortSignals[0].debug;
        assert.ok(debug.ema_fast !== undefined, 'Should have ema_fast in debug');
        assert.ok(debug.ema_slow !== undefined, 'Should have ema_slow in debug');
        assert.ok(debug.rsi !== undefined, 'Should have rsi in debug');
        assert.ok(debug.signal === 'SHORT', 'Should have signal=SHORT in debug');
        assert.ok(debug.entry_price !== undefined, 'Should have entry_price in debug');
        assert.ok(debug.stop_loss !== undefined, 'Should have stop_loss in debug');
        assert.ok(debug.take_profit !== undefined, 'Should have take_profit in debug');
        assert.ok(debug.confluences !== undefined, 'Should have confluences in debug');
      }
    });
  });
});
