import assert from 'assert';
import { PositionHistorySyncService } from '../../src/strategy/position_history_sync_service';
import type { Profile } from '../../src/profile/types';

describe('#PositionHistorySyncService', () => {
  let profileServiceMock: any;
  let positionHistoryRepositoryMock: any;
  let loggerMock: any;

  const profile: Profile = {
    id: 'profile-1',
    name: 'Profile 1',
    exchange: 'binance',
    apiKey: 'key',
    secret: 'secret'
  };

  beforeEach(() => {
    profileServiceMock = {
      fetchOpenPositions: async () => []
    };
    positionHistoryRepositoryMock = {
      getOpenPositions: () => [],
      reconcileOpenPositions: () => {}
    };
    loggerMock = {
      warn: () => {},
      info: () => {},
      error: () => {}
    };
  });

  it('reconciles stale open rows when exchange is flat', async () => {
    let reconciled: any[] = [];
    positionHistoryRepositoryMock.getOpenPositions = () => [
      { bot_id: 'bot-1', symbol: 'BTC/USDT:USDT', side: 'long', status: 'open' }
    ];
    positionHistoryRepositoryMock.reconcileOpenPositions = (...args: any[]) => {
      reconciled = args;
    };

    const service = new PositionHistorySyncService(profileServiceMock, positionHistoryRepositoryMock, loggerMock as any);
    const result = await service.reconcileLiveBot(profile, { id: 'bot-1', name: 'Bot 1', pair: 'BTC/USDT:USDT' });

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(reconciled, ['profile-1', 'bot-1', 'BTC/USDT:USDT', 'reconciled']);
  });

  it('warns only when exchange has open position but history is flat', async () => {
    let warned = false;
    profileServiceMock.fetchOpenPositions = async () => [
      { symbol: 'BTC/USDT:USDT', side: 'short', contracts: 0.02, raw: {} }
    ];
    loggerMock.warn = () => {
      warned = true;
    };

    const service = new PositionHistorySyncService(profileServiceMock, positionHistoryRepositoryMock, loggerMock as any);
    const result = await service.reconcileLiveBot(profile, { id: 'bot-1', name: 'Bot 1', pair: 'BTC/USDT:USDT' });

    assert.ok(result);
    assert.strictEqual(result?.side, 'short');
    assert.ok(warned);
  });
});
