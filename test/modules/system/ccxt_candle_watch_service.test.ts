import assert from 'assert';
const { CcxtCandleWatchService } = require('../../../src/modules/system/ccxt_candle_watch_service');

describe('#CcxtCandleWatchService Binance futures normalization', () => {
  it('routes legacy dashboard Binance perpetual pairs to the USD-M watcher', () => {
    const service = new CcxtCandleWatchService(
      { insertCandles: async () => {} } as any,
      {
        getConfig: () => ({
          periods: ['5m'],
          pairs: [{ exchange: 'binance', symbol: 'BTC/USDT:USDT' }]
        })
      } as any,
      { debug: () => {}, error: () => {} } as any,
      { getProfiles: () => [] } as any
    );

    const watcherCalls: any[] = [];
    (service as any).runWatcher = (exchangeId: string, pairs: [string, string][], gen: number) => {
      watcherCalls.push({ exchangeId, pairs, gen });
    };

    (service as any).startSubscriptions();

    assert.strictEqual(watcherCalls.length, 1);
    assert.strictEqual(watcherCalls[0].exchangeId, 'binanceusdm');
    assert.deepStrictEqual(watcherCalls[0].pairs, [['BTC/USDT:USDT', '5m']]);
  });

  it('marks pairs unhealthy and starts fallback polling after watcher timeout', async () => {
    let fallbackCalls = 0;
    const insertedBatches: any[] = [];
    const service = new CcxtCandleWatchService(
      { insertCandles: async (candles: any[]) => insertedBatches.push(candles) } as any,
      { getConfig: () => ({ periods: [], pairs: [] }) } as any,
      { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any,
      { getProfiles: () => [] } as any,
      {
        fetchDirect: async () => {
          fallbackCalls += 1;
          return [{ time: 1700000000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }];
        }
      } as any
    );

    await (service as any).markPairsDegraded('binanceusdm', [['BTC/USDT:USDT', '5m']]);

    assert.strictEqual(service.isSubscriptionHealthy('binanceusdm', 'BTC/USDT:USDT', '5m'), false);
    assert.strictEqual(fallbackCalls, 1);
    assert.strictEqual(insertedBatches.length, 1);
  });
});
