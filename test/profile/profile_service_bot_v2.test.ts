import assert from 'assert';
import { ProfileService } from '../../src/profile/profile_service';
import type { Profile } from '../../src/profile/types';

describe('#profile service bot v2', () => {
  it('creates, updates, and deletes bot v2 without affecting legacy bots', () => {
    const profiles: Profile[] = [
      {
        id: 'p1',
        name: 'Profile 1',
        exchange: 'binance',
        bots: [
          {
            id: 'legacy-1',
            name: 'Legacy Bot',
            strategy: 'macd',
            pair: 'BTC/USDT',
            interval: '15m',
            capital: 100,
            mode: 'watch',
            status: 'running',
            useAiValidator: true
          }
        ],
        botsV2: []
      }
    ];

    const configService = {
      getProfiles: () => profiles,
      saveProfiles: (_next: Profile[]) => {}
    } as any;

    const exchangeInstanceService = {
      invalidateProfile: (_id: string) => {},
      getProfileExchange: async () => ({})
    } as any;

    const binancePriceService = {
      getUsdtPrices: async () => ({})
    } as any;

    const profileService = new ProfileService(configService, exchangeInstanceService, binancePriceService);

    const created = profileService.createBotV2('p1', {
      name: 'V2 Bot',
      strategy: 'macd',
      pair: 'BTC/USDT:USDT',
      interval: '15m',
      capital: 200,
      status: 'stopped',
      executionMode: 'paper',
      adaptiveEnabled: true
    });

    assert.ok(created.id.startsWith('botv2_'));
    assert.strictEqual(profileService.getBots('p1').length, 1, 'legacy bot list must stay intact');
    assert.strictEqual(profileService.getBotsV2('p1').length, 1);

    const updated = profileService.updateBotV2('p1', created.id, {
      maxDrawdownPct: 9,
      executionMode: 'live',
      status: 'running'
    });

    assert.strictEqual(updated.maxDrawdownPct, 9);
    assert.strictEqual(updated.executionMode, 'live');
    assert.strictEqual(updated.status, 'running');

    profileService.deleteBotV2('p1', created.id);
    assert.strictEqual(profileService.getBotsV2('p1').length, 0);
    assert.strictEqual(profileService.getBots('p1').length, 1, 'legacy bot list must remain unchanged after V2 delete');
  });
});
