import assert from 'assert';
import { BotRunner } from '../../src/strategy/bot_runner';
import type { Profile, Bot } from '../../src/profile/types';

describe('#BotRunner notification order pnl autopause', () => {
  // Mock dependencies
  let sentMessages: string[] = [];
  let profileServiceMock: any;
  let strategyExecutorMock: any;
  let notifierMock: any;
  let signalRepositoryMock: any;
  let positionHistoryRepositoryMock: any;
  let positionHistorySyncServiceMock: any;
  let loggerMock: any;

  const createBotRunner = () => {
    return new BotRunner(
      profileServiceMock,
      strategyExecutorMock,
      notifierMock,
      signalRepositoryMock,
      positionHistoryRepositoryMock,
      positionHistorySyncServiceMock,
      loggerMock
    );
  };

  const createTestProfile = (withApiKeys: boolean = true): Profile => ({
    id: 'test-profile-1',
    name: 'Test Profile',
    exchange: 'binance',
    apiKey: withApiKeys ? 'test-key' : undefined,
    secret: withApiKeys ? 'test-secret' : undefined,
    bots: [
      {
        id: 'test-bot-1',
        name: 'Test Bot',
        strategy: 'macd',
        pair: 'BTC/USDT',
        interval: '15m',
        capital: 1000,
        mode: 'trade',
        status: 'running',
        useAiValidator: false
      }
    ]
  });

  const createTestBot = (): Bot => ({
    id: 'test-bot-1',
    name: 'Test Bot',
    strategy: 'macd',
    pair: 'BTC/USDT',
    interval: '15m',
    capital: 1000,
    mode: 'trade',
    status: 'running',
    useAiValidator: false
  });

  beforeEach(() => {
    sentMessages = [];

    profileServiceMock = {
      getProfiles: () => [],
      getProfile: (id: string) => undefined,
      fetchTicker: async () => ({ bid: 50000, ask: 50000, last: 50000 }),
      fetchBalances: async () => [{ currency: 'BTC', total: 0.1, free: 0.1, used: 0 }],
      fetchOpenPositions: async () => [],
      placeOrder: async () => ({ id: 'order-1', price: 50000, amount: 0.02 } as OrderResult),
      closePosition: async () => ({ id: 'close-1', price: 51000, amount: -0.02 }),
      updateBot: () => {}
    };

    strategyExecutorMock = {
      executeStrategy: async () => null
    };

    notifierMock = {
      send: (message: string) => {
        sentMessages.push(message);
      }
    };

    signalRepositoryMock = {
      insertSignal: () => {}
    };

    positionHistoryRepositoryMock = {
      openPosition: () => {},
      closePosition: () => {},
      getOpenPositions: () => []
    };

    positionHistorySyncServiceMock = {
      reconcileLiveBot: async (_profile: any, _bot: any) => undefined
    };

    loggerMock = {
      info: () => {},
      warn: () => {},
      error: () => {}
    };
  });

  describe('ORDER_OK notifications', () => {
    it('sends ORDER_OK for successful live long order', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      profileServiceMock.getProfile = (id: string) => id === profile.id ? profile : undefined;
      strategyExecutorMock.executeStrategy = async () => 'long';

      const botRunner = createBotRunner();

      // Access private method for testing
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      // Should send signal notification first
      assert.ok(sentMessages.some(m => m.includes('[long')));
      // Should send ORDER_OK notification
      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('signal=long')));
      assert.ok(sentMessages.some(m => m.includes('mode=live')));
    });

    it('sends ORDER_OK for successful live short order', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'short';

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('signal=short')));
    });

    it('sends ORDER_OK for successful live futures close', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' }; // Futures pair

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'close';
      profileServiceMock.fetchOpenPositions = async () => [{ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} }];
      positionHistorySyncServiceMock.reconcileLiveBot = async () => ({ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} });

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('signal=close')));
      // Should also send PNL notification
      assert.ok(sentMessages.some(m => m.includes('[PNL]')));
    });

    it('sends ORDER_OK for successful live spot close', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'close';
      profileServiceMock.fetchBalances = async () => [
        { currency: 'BTC', total: 0.1, free: 0.1, used: 0, usdValue: 5000 }
      ];

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('signal=close')));
      assert.ok(sentMessages.some(m => m.includes('[PNL]')));
    });
  });

  describe('ORDER_FAIL notifications', () => {
    it('sends ORDER_FAIL when live placeOrder throws', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'long';
      profileServiceMock.placeOrder = async () => {
        throw new Error('Insufficient balance');
      };

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);

      // Error is re-thrown after ORDER_FAIL notification is sent
      try {
        await runBot(bot, profile);
      } catch (err) {
        // Expected - error is re-thrown
      }

      assert.ok(sentMessages.some(m => m.includes('[ORDER_FAIL]')));
      assert.ok(sentMessages.some(m => m.includes('error="Insufficient balance"')));
    });

    it('sends ORDER_FAIL when live closePosition throws', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' };

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'close';
      profileServiceMock.fetchOpenPositions = async () => [{ symbol: bot.pair, side: 'short', contracts: 0.02, raw: {} }];
      positionHistorySyncServiceMock.reconcileLiveBot = async () => ({ symbol: bot.pair, side: 'short', contracts: 0.02, raw: {} });
      profileServiceMock.closePosition = async () => {
        throw new Error('Position not found');
      };

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      
      try {
        await runBot(bot, profile);
      } catch (err) {
        // Expected - error is re-thrown
      }

      assert.ok(sentMessages.some(m => m.includes('[ORDER_FAIL]')));
      assert.ok(sentMessages.some(m => m.includes('signal=close')));
    });
  });

  describe('PNL notifications', () => {
    it('sends PNL notification with correct format', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' };

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'close';
      profileServiceMock.fetchOpenPositions = async () => [{ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} }];
      positionHistorySyncServiceMock.reconcileLiveBot = async () => ({ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} });
      profileServiceMock.closePosition = async () => ({ id: 'close-1', price: 51000, amount: -0.02 });

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      const pnlMessage = sentMessages.find(m => m.includes('[PNL]'));
      assert.ok(pnlMessage);
      assert.ok(pnlMessage!.includes('pnl='));
      assert.ok(pnlMessage!.includes('pnlPct='));
    });
  });

  describe('Paper mode notifications', () => {
    it('sends ORDER_OK for successful paper close', async () => {
      const profile = createTestProfile(false); // No API keys = paper mode
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'close';

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('mode=paper')));
      assert.ok(sentMessages.some(m => m.includes('[PNL]')));
    });

    it('sends ORDER_OK for successful paper long order', async () => {
      const profile = createTestProfile(false);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'long';

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]')));
      assert.ok(sentMessages.some(m => m.includes('mode=paper')));
      assert.ok(sentMessages.some(m => m.includes('signal=long')));
    });
  });

  describe('AUTO_PAUSE notifications', () => {
    it('sends AUTO_PAUSE and stops bot when handleAutoPause called with running bot', () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();
      bot.status = 'running';

      let updatedStatus: string | undefined;
      profileServiceMock.updateBot = (_profileId: string, _botId: string, updates: any) => {
        updatedStatus = updates.status;
      };

      const botRunner = createBotRunner();
      botRunner.handleAutoPause(profile, bot, 'Risk limit exceeded');

      assert.ok(sentMessages.some(m => m.includes('[AUTO_PAUSE]')));
      assert.ok(sentMessages.some(m => m.includes('reason=Risk limit exceeded')));
      assert.strictEqual(updatedStatus, 'stopped');
    });

    it('does not send AUTO_PAUSE when bot is not running', () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();
      bot.status = 'stopped';

      let updateCalled = false;
      profileServiceMock.updateBot = () => {
        updateCalled = true;
      };

      const botRunner = createBotRunner();
      botRunner.handleAutoPause(profile, bot, 'Risk limit exceeded');

      assert.strictEqual(sentMessages.filter(m => m.includes('[AUTO_PAUSE]')).length, 0);
      assert.ok(!updateCalled);
    });
  });

  describe('Signal notification regression', () => {
    it('still sends existing signal notification (no regression)', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'long';

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      // Check that signal notification is still sent
      assert.ok(sentMessages.some(m => m.includes('[long')));
      assert.ok(sentMessages.some(m => m.includes('(macd)')));
      assert.ok(sentMessages.some(m => m.includes('BTC/USDT')));
    });

    it('sends signal notification with correct format', async () => {
      const profile = createTestProfile(true);
      const bot = createTestBot();

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'short';

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      const signalMessage = sentMessages.find(m => m.includes('[short'));
      assert.ok(signalMessage);
      assert.ok(signalMessage!.includes('@'));  // Should include price with @
    });
  });

  describe('Live futures position sync', () => {
    it('skips close silently when exchange position is already flat', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' };

      let closeCalls = 0;
      profileServiceMock.getProfiles = () => [profile];
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
      assert.strictEqual(sentMessages.filter(m => m.includes('[ORDER_FAIL]')).length, 0);
      assert.strictEqual(sentMessages.filter(m => m.includes('[ORDER_OK]') && m.includes('signal=close')).length, 0);
    });

    it('auto-reverses from short to long for futures', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' };
      const callOrder: string[] = [];

      profileServiceMock.getProfiles = () => [profile];
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
      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]') && m.includes('signal=close')));
      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]') && m.includes('signal=long')));
    });

    it('auto-reverses from long to short for futures', async () => {
      const profile = createTestProfile(true);
      const bot = { ...createTestBot(), pair: 'BTC/USDT:USDT' };
      const callOrder: string[] = [];

      profileServiceMock.getProfiles = () => [profile];
      strategyExecutorMock.executeStrategy = async () => 'short';
      profileServiceMock.fetchOpenPositions = async () => [{ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} }];
      positionHistorySyncServiceMock.reconcileLiveBot = async () => ({ symbol: bot.pair, side: 'long', contracts: 0.02, raw: {} });
      profileServiceMock.closePosition = async () => {
        callOrder.push('close');
        return { id: 'close-1', price: 51000, amount: -0.02 };
      };
      profileServiceMock.placeOrder = async () => {
        callOrder.push('open-short');
        return { id: 'order-1', price: 50000, amount: 0.02, raw: {} };
      };

      const botRunner = createBotRunner();
      const runBot = (botRunner as any).runBot.bind(botRunner);
      await runBot(bot, profile);

      assert.deepStrictEqual(callOrder, ['close', 'open-short']);
      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]') && m.includes('signal=close')));
      assert.ok(sentMessages.some(m => m.includes('[ORDER_OK]') && m.includes('signal=short')));
    });
  });
});
