import assert from 'assert';
import Sqlite from 'better-sqlite3';
import { DATABASE_SCHEMA } from '../../src/utils/database_schema';
import { AiPolicyRepository } from '../../src/repository/ai_policy_repository';
import { AdaptivePolicyService } from '../../src/ai/adaptive_policy_service';
import type { BotV2 } from '../../src/profile/types';

describe('#adaptive policy service', () => {
  function makeService() {
    const db = new Sqlite(':memory:');
    db.exec(DATABASE_SCHEMA);
    const repo = new AiPolicyRepository(db as any);
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any;
    return { service: new AdaptivePolicyService(repo, logger), repo };
  }

  function makeBot(overrides: Partial<BotV2> = {}): BotV2 {
    return {
      id: 'botv2_1',
      name: 'bot v2',
      strategy: 'macd',
      pair: 'BTC/USDT:USDT',
      interval: '15m',
      capital: 1000,
      status: 'running',
      useAiValidator: true,
      executionMode: 'paper',
      adaptiveEnabled: true,
      adaptiveUpdateEveryTrades: 20,
      maxDrawdownPct: 12,
      futuresOnlyLongShort: true,
      aiMinConfidence: 0.7,
      ...overrides
    };
  }

  it('bootstraps initial policy', () => {
    const { service } = makeService();
    const bot = makeBot();
    const confidence = service.getPolicyMinConfidence('p1', bot);
    assert.strictEqual(confidence, 0.7);
  });

  it('pauses bot when drawdown is above max threshold', () => {
    const { service } = makeService();
    const bot = makeBot({ maxDrawdownPct: 10 });
    service.recordClosedTrade('p1', bot, { realizedPnl: -150 });

    const status = service.getPolicyStatus('p1', bot);
    assert.strictEqual(status.paused, true);
  });
});
