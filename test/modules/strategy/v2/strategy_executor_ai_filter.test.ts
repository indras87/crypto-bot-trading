import assert from 'assert';
import { StrategyExecutor } from '../../../../src/modules/strategy/v2/typed_backtest';
import type { Candlestick } from '../../../../src/dict/candlestick';

describe('#strategy executor live ai filter', () => {
  const makeExecutor = (signal: 'long' | 'short' | 'close') => {
    const strategyRegistry = {
      getStrategyClass: (_strategyName: string) =>
        class {
          constructor(_options: Record<string, any>) {}
        }
    } as any;

    const executor = new StrategyExecutor(
      { isValidCandleStickLookback: () => true } as any,
      { fetchCombinedCandles: async () => ({}) } as any,
      { info: () => {}, debug: () => {}, error: () => {} } as any,
      { isWatched: () => false } as any,
      {
        fetchDirect: async () =>
          [
            { time: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
            { time: 1700000060, open: 100, high: 102, low: 99, close: 101, volume: 12 }
          ] as Candlestick[]
      } as any,
      strategyRegistry,
      {
        isEnabled: () => true,
        analyze: async () => ({ confirmed: true, confidence: 0.9, action: 'confirm', reasoning: 'ok', riskLevel: 'low' })
      } as any,
      { recordValidation: () => {}, getStatusSummary: () => 'AI status' } as any
    );

    (executor as any).execute = async () => [
      {
        time: 1700000000,
        price: 100,
        signal,
        debug: { foo: 'bar' }
      }
    ];

    return executor;
  };

  it('does not call ai analyze for close signal', async () => {
    let analyzeCalls = 0;
    const executor = makeExecutor('close');
    (executor as any).aiService = {
      isEnabled: () => true,
      analyze: async () => {
        analyzeCalls += 1;
        return { confirmed: true, confidence: 0.9, action: 'confirm', reasoning: 'ok', riskLevel: 'low' };
      }
    };

    const result = await executor.executeStrategy('noop', 'binance', 'BTC/USDT', '1m', {}, { useAiValidator: true });
    assert.strictEqual(result, 'close');
    assert.strictEqual(analyzeCalls, 0);
  });

  it('still calls ai analyze for long signal and can reject it', async () => {
    let analyzeCalls = 0;
    const executor = makeExecutor('long');
    (executor as any).aiService = {
      isEnabled: () => true,
      analyze: async () => {
        analyzeCalls += 1;
        return { confirmed: false, confidence: 0.4, action: 'reject', reasoning: 'reject', riskLevel: 'high' };
      }
    };

    const result = await executor.executeStrategy('noop', 'binance', 'BTC/USDT', '1m', {}, { useAiValidator: true });
    assert.strictEqual(result, undefined);
    assert.strictEqual(analyzeCalls, 1);
  });

  it('falls back to REST when pair is watched but websocket is unhealthy', async () => {
    let fetchDirectCalls = 0;
    let fetchCombinedCalls = 0;

    const strategyRegistry = {
      getStrategyClass: (_strategyName: string) =>
        class {
          constructor(_options: Record<string, any>) {}
        }
    } as any;

    const executor = new StrategyExecutor(
      { isValidCandleStickLookback: () => true } as any,
      {
        fetchCombinedCandles: async () => {
          fetchCombinedCalls += 1;
          return { binanceusdm: [] };
        }
      } as any,
      { info: () => {}, debug: () => {}, error: () => {} } as any,
      { isWatched: () => true, isSubscriptionHealthy: () => false } as any,
      {
        fetchDirect: async () => {
          fetchDirectCalls += 1;
          return [
            { time: 1700000000, open: 100, high: 101, low: 99, close: 100, volume: 10 },
            { time: 1700000060, open: 100, high: 102, low: 99, close: 101, volume: 12 }
          ] as Candlestick[];
        }
      } as any,
      strategyRegistry
    );

    (executor as any).execute = async () => [
      {
        time: 1700000060,
        price: 101,
        signal: 'long',
        debug: {}
      }
    ];

    const result = await executor.executeStrategy('noop', 'binanceusdm', 'BTC/USDT:USDT', '1m', {}, { useAiValidator: false });

    assert.strictEqual(result, 'long');
    assert.strictEqual(fetchDirectCalls, 1);
    assert.strictEqual(fetchCombinedCalls, 0);
  });
});
