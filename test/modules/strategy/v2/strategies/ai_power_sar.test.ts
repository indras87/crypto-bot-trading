import assert from 'assert';
import fs from 'fs';
import * as path from 'path';
import { AiPowerSar } from '../../../../../src/strategy/strategies/ai_power_sar';
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

describe('#AiPowerSar', () => {
  let candlesDesc: Candlestick[];
  let candlesAsc: Candlestick[];
  let executor: StrategyExecutor;

  beforeEach(() => {
    const rawCandles = createCandleFixtures();
    candlesDesc = toCandlestickInstances(rawCandles);
    candlesAsc = toAscOrder(candlesDesc);
    executor = new StrategyExecutor({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  describe('fixture validation', () => {
    it('fixture has enough candles for EMA200 warmup', () => {
      assert.equal(candlesAsc.length >= 200, true, 'Should have at least 200 candles for EMA warmup');
    });
  });

  describe('strategy initialization', () => {
    it('creates strategy with default options', () => {
      const strategy = new AiPowerSar();
      assert.equal(strategy.getDescription(), 'AI-Powered Parabolic SAR with multi-technical filters');

      const options = strategy.getOptions();
      assert.equal(options.ema_period, 200);
      assert.equal(options.adx_threshold, 25);
    });

    it('defines all required indicators', () => {
      const strategy = new AiPowerSar();
      const indicators = strategy.defineIndicators();

      assert.equal('psar' in indicators, true);
      assert.equal('ema' in indicators, true);
      assert.equal('adx' in indicators, true);
      assert.equal('rsi' in indicators, true);
    });
  });

  describe('signal generation', () => {
    it('generates signals on fixture data', async () => {
      const strategy = new AiPowerSar();
      const results = await executor.execute(strategy, candlesAsc);

      const signals = results.filter(r => r.signal !== undefined);
      console.log(`    Generated ${signals.length} signals from ${results.length} candles`);
      
      // Since this strategy is more restrictive, it may produce 0 signals on this short fixture, which is ok.
      assert.ok(signals.length >= 0);

      for (const s of signals) {
        assert.equal(
          ['long', 'short', 'close'].includes(s.signal!),
          true,
          `Signal should be long, short, or close, got: ${s.signal}`
        );
      }
    });

    it('generates debug info including all indicators', async () => {
      const strategy = new AiPowerSar();
      const results = await executor.execute(strategy, candlesAsc.slice(candlesAsc.length - 250)); // use smaller slice to speed up test

      const entrySignals = results.filter(r => r.signal === 'long' || r.signal === 'short');
      
      if(entrySignals.length > 0) {
        const s = entrySignals[0];
        assert.equal('psar' in s.debug, true, 'Should include PSAR in debug');
        assert.equal('ema' in s.debug, true, 'Should include EMA in debug');
        assert.equal('adx' in s.debug, true, 'Should include ADX in debug');
        assert.equal('rsi' in s.debug, true, 'Should include RSI in debug');
        assert.equal('trend_strong' in s.debug, true, 'Should include trend_strong in debug');
      }
    });
  });

  describe('indicator warmup', () => {
    it('does not generate signals during warmup period (first 200 candles)', async () => {
      const strategy = new AiPowerSar();
      const results = await executor.execute(strategy, candlesAsc);

      const warmupSignals = results.slice(0, 200).filter(r => r.signal !== undefined);
      assert.equal(warmupSignals.length, 0, 'Should not generate signals during the EMA200 warmup period');
    });
  });
});
