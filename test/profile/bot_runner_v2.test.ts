import assert from 'assert';
import { BotRunnerV2 } from '../../src/strategy/bot_runner_v2';
import type { BotV2, Profile } from '../../src/profile/types';

describe('#BotRunnerV2 live futures sync', () => {
  let profileServiceMock: any;
  let strategyExecutorMock: any;
  let notifierMock: any;
  let signalRepositoryMock: any;
  let positionHistoryRepositoryMock: any;
  let positionHistorySyncServiceMock: any;
  let adaptivePolicyServiceMock: any;
  let loggerMock: any;

  const createBotRunner = () => new BotRunnerV2(
    profileServiceMock,
    strategyExecutorMock,
    notifierMock,
    signalRepositoryMock,
    positionHistoryRepositoryMock,
    positionHistorySyncServiceMock,
    adaptivePolicyServiceMock,
    loggerMock
  );

  const createTestProfile = (): Profile => ({
    id: 'test-profile-1',
    name: 'Test Profile',
    exchange: 'binance',
    apiKey: 'test-key',
    secret: 'test-secret',
    botsV2: []
  });

  const createTestBot = (): BotV2 => ({
    id: 'test-bot-v2-1',
    name: 'Test Bot V2',
    strategy: 'fast_momentum_rsi_macd',
    pair: 'BTC/USDT:USDT',
    interval: '15m',
    capital: 1000,
    status: 'running',
    executionMode: 'live',
    useAiValidator: false
  });

  beforeEach(() => {
    profileServiceMock = {
      getProfiles: () => [],
      fetchTicker: async () => ({ bid: 50000, ask: 50000, last: 50000 }),
      fetchOpenPositions: async () => [],
      placeOrder: async () => ({ id: 'order-1', price: 50000, amount: 0.02, raw: {} }),
      closePosition: async () => ({ id: 'close-1', price: 51000, amount: -0.02 }),
      updateBotV2: () => {}
    };

    strategyExecutorMock = {
      executeStrategy: async () => undefined
    };

    notifierMock = { send: () => {} };
    signalRepositoryMock = { insertSignal: () => {} };
    positionHistoryRepositoryMock = {
      openPosition: () => {},
      closePosition: () => {},
      getOpenPositions: () => []
    };
    positionHistorySyncServiceMock = {
      reconcileLiveBot: async () => undefined
    };
    adaptivePolicyServiceMock = {
      ensureInitialPolicy: () => {},
      isPaused: () => false,
      getEffectiveConfig: () => ({ executionMode: 'live', futuresOnlyLongShort: false }),
      getLiveGateStatus: () => ({ eligible: true }),
      recordClosedTrade: () => undefined
    };
    loggerMock = { info: () => {}, warn: () => {}, error: () => {} };
  });

  it('skips close when exchange position is already flat', async () => {
    const profile = createTestProfile();
    const bot = createTestBot();
    let closeCalls = 0;

    strategyExecutorMock.executeStrategy = async () => 'close';
    profileServiceMock.fetchOpenPositions = async () => [];
    positionHistorySyncServiceMock.reconcileLiveBot = async () => undefined;
    profileServiceMock.closePosition = async () => {
      closeCalls += 1;
      return { id: 'close-1', price: 51000, amount: -0.02 };
    };

    const botRunner = createBotRunner();
    const runBot = (botRunner as any).runBot.bind(botRunner);
    await runBot(bot, profile);

    assert.strictEqual(closeCalls, 0);
  });

  it('auto-reverses from short to long in live futures mode', async () => {
    const profile = createTestProfile();
    const bot = createTestBot();
    const callOrder: string[] = [];

    strategyExecutorMock.executeStrategy = async () => 'long';
    profileServiceMock.fetchOpenPositions = async () => [{ symbol: bot.pair, side: 'short', contracts: 0.02, raw: {} }];
    positionHistorySyncServiceMock.reconcileLiveBot = async () => ({ symbol: bot.pair, side: 'short', contracts: 0.02, raw: {} });
    profileServiceMock.closePosition = async () => {
      callOrder.push('close');
      return { id: 'close-1', price: 49000, amount: 0.02 };
    };
    profileServiceMock.placeOrder = async () => {
      callOrder.push('open-long');
      return { id: 'order-1', price: 50000, amount: 0.02, raw: {} };
    };

    const botRunner = createBotRunner();
    const runBot = (botRunner as any).runBot.bind(botRunner);
    await runBot(bot, profile);

    assert.deepStrictEqual(callOrder, ['close', 'open-long']);
  });
});
