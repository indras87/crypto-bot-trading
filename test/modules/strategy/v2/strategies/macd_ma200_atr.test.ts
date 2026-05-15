import assert from 'assert';
import { StrategySignal, TypedStrategyContext, type MacdResult } from '../../../../../src/strategy/strategy';
import { MacdMa200Atr } from '../../../../../src/strategy/strategies/macd_ma200_atr';

function createContext(
  price: number,
  ema200: number[],
  atr: number[],
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
      atr,
      macd
    },
    lastSignal,
    [price]
  );
}

describe('#MacdMa200Atr', () => {
  describe('initialization', () => {
    it('uses expected default options', () => {
      const strategy = new MacdMa200Atr();
      const options = strategy.getOptions();

      assert.equal(options.ema_length, 200);
      assert.equal(options.macd_fast, 12);
      assert.equal(options.macd_slow, 26);
      assert.equal(options.macd_signal, 9);
      assert.equal(options.atr_length, 14);
      assert.equal(options.atr_sl_multiplier, 1);
      assert.equal(options.atr_tp_multiplier, 1.5);
      assert.equal(options.allow_long, true);
      assert.equal(options.allow_short, true);
    });
  });

  describe('entry rules', () => {
    it('opens long when price is above EMA200 and MACD golden cross happens below zero', async () => {
      const strategy = new MacdMa200Atr();
      const context = createContext(
        105,
        [100, 101],
        [2, 2],
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

    it('rejects long when MACD golden cross happens above zero', async () => {
      const strategy = new MacdMa200Atr();
      const context = createContext(
        105,
        [100, 101],
        [2, 2],
        [
          { macd: 0.8, signal: 1.0 },
          { macd: 1.2, signal: 1.1 }
        ],
        undefined
      );
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, undefined);
      assert.equal(signal.getDebug().long_setup_ready, false);
    });

    it('opens short when price is below EMA200 and MACD death cross happens above zero', async () => {
      const strategy = new MacdMa200Atr();
      const context = createContext(
        95,
        [100, 99],
        [2, 2],
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

    it('rejects short when death cross happens below zero', async () => {
      const strategy = new MacdMa200Atr();
      const context = createContext(
        95,
        [100, 99],
        [2, 2],
        [
          { macd: -0.8, signal: -1.0 },
          { macd: -1.2, signal: -1.1 }
        ],
        undefined
      );
      const signal = new StrategySignal();

      await strategy.execute(context, signal);

      assert.equal(signal.signal, undefined);
      assert.equal(signal.getDebug().short_setup_ready, false);
    });
  });

  describe('ATR exits', () => {
    it('closes long on ATR take profit', async () => {
      const strategy = new MacdMa200Atr({ atr_sl_multiplier: 1, atr_tp_multiplier: 1.5 });

      const openContext = createContext(
        105,
        [100, 101],
        [2, 2],
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
        108.1,
        [101, 102],
        [2.5, 2.5],
        [
          { macd: -0.6, signal: -0.7 },
          { macd: -0.5, signal: -0.6 }
        ],
        'long'
      );
      const exitSignal = new StrategySignal();
      await strategy.execute(exitContext, exitSignal);

      assert.equal(exitSignal.signal, 'close');
      assert.equal(exitSignal.getDebug().exit_reason, 'atr_take_profit');
    });

    it('closes short on ATR stop loss', async () => {
      const strategy = new MacdMa200Atr({ atr_sl_multiplier: 1, atr_tp_multiplier: 1.5 });

      const openContext = createContext(
        95,
        [100, 99],
        [2, 2],
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
        97.2,
        [99, 98],
        [2.5, 2.5],
        [
          { macd: 0.7, signal: 0.8 },
          { macd: 0.6, signal: 0.7 }
        ],
        'short'
      );
      const exitSignal = new StrategySignal();
      await strategy.execute(exitContext, exitSignal);

      assert.equal(exitSignal.signal, 'close');
      assert.equal(exitSignal.getDebug().exit_reason, 'atr_stop_loss');
    });

    it('ignores opposite cross while position is open if ATR exit has not triggered', async () => {
      const strategy = new MacdMa200Atr();

      const openContext = createContext(
        105,
        [100, 101],
        [2, 2],
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
        105.5,
        [101, 102],
        [2.2, 2.2],
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
