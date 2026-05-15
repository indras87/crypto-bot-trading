import assert from 'assert';
import { StrategySignal, TypedStrategyContext, type MacdResult } from '../../../../../src/strategy/strategy';
import { MacdMa200FixedRisk } from '../../../../../src/strategy/strategies/macd_ma200_fixed_risk';

function createContext(
  price: number,
  ema200: number[],
  macdRows: Array<{ macd: number; signal: number }>,
  lastSignal: 'long' | 'short' | 'close' | undefined
): TypedStrategyContext<any> {
  const macd: MacdResult[] = macdRows.map(row => ({
    macd: row.macd,
    signal: row.signal,
    histogram: row.macd - row.signal
  }));

  return new TypedStrategyContext<any>(
    price,
    {
      ema200,
      macd
    },
    lastSignal,
    [price]
  );
}

describe('#MacdMa200FixedRisk', () => {
  describe('initialization', () => {
    it('uses expected default options', () => {
      const strategy = new MacdMa200FixedRisk();
      const options = strategy.getOptions();

      assert.equal(options.ema_length, 200);
      assert.equal(options.macd_fast, 12);
      assert.equal(options.macd_slow, 26);
      assert.equal(options.macd_signal, 9);
      assert.equal(options.take_profit_pct, 2);
      assert.equal(options.stop_loss_pct, 6);
      assert.equal(options.allow_long, true);
      assert.equal(options.allow_short, true);
    });
  });

  describe('entry rules', () => {
    it('opens long when price is above EMA200 and MACD golden cross happens below zero', async () => {
      const strategy = new MacdMa200FixedRisk();
      const context = createContext(
        105,
        [100, 101],
        [
          { macd: -1.2, signal: -1.0 },
          { macd: -0.8, signal: -0.9 }
        ],
        undefined
      );
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, 'long');
      assert.equal(signal.getDebug().long_setup_ready, true);
    });

    it('opens short when price is below EMA200 and MACD death cross happens above zero', async () => {
      const strategy = new MacdMa200FixedRisk();
      const context = createContext(
        95,
        [100, 99],
        [
          { macd: 1.2, signal: 1.0 },
          { macd: 0.8, signal: 0.9 }
        ],
        undefined
      );
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, 'short');
      assert.equal(signal.getDebug().short_setup_ready, true);
    });
  });

  describe('fixed exits', () => {
    it('closes long on fixed take profit', async () => {
      const strategy = new MacdMa200FixedRisk();

      const openContext = createContext(
        100,
        [99, 99.5],
        [
          { macd: -1.2, signal: -1.0 },
          { macd: -0.8, signal: -0.9 }
        ],
        undefined
      );
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'long');

      const exitContext = createContext(
        102.1,
        [99.5, 100],
        [
          { macd: -0.6, signal: -0.7 },
          { macd: -0.5, signal: -0.6 }
        ],
        'long'
      );
      const exitSignal = new StrategySignal();
      await strategy.execute(exitContext, exitSignal);

      assert.equal(exitSignal.signal, 'close');
      assert.equal(exitSignal.getDebug().exit_reason, 'fixed_take_profit');
    });

    it('closes short on fixed stop loss', async () => {
      const strategy = new MacdMa200FixedRisk();

      const openContext = createContext(
        100,
        [101, 100.5],
        [
          { macd: 1.2, signal: 1.0 },
          { macd: 0.8, signal: 0.9 }
        ],
        undefined
      );
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'short');

      const exitContext = createContext(
        106.1,
        [100.5, 100],
        [
          { macd: 0.7, signal: 0.8 },
          { macd: 0.6, signal: 0.7 }
        ],
        'short'
      );
      const exitSignal = new StrategySignal();
      await strategy.execute(exitContext, exitSignal);

      assert.equal(exitSignal.signal, 'close');
      assert.equal(exitSignal.getDebug().exit_reason, 'fixed_stop_loss');
    });

    it('ignores opposite cross while position is open if fixed exit has not triggered', async () => {
      const strategy = new MacdMa200FixedRisk();

      const openContext = createContext(
        100,
        [99, 99.5],
        [
          { macd: -1.2, signal: -1.0 },
          { macd: -0.8, signal: -0.9 }
        ],
        undefined
      );
      const openSignal = new StrategySignal();
      await strategy.execute(openContext, openSignal);
      assert.equal(openSignal.signal, 'long');

      const holdContext = createContext(
        100.8,
        [99.5, 100],
        [
          { macd: 1.2, signal: 1.0 },
          { macd: 0.8, signal: 0.9 }
        ],
        'long'
      );
      const holdSignal = new StrategySignal();
      await strategy.execute(holdContext, holdSignal);

      assert.equal(holdSignal.signal, undefined);
    });
  });
});
