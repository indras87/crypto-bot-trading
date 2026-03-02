import assert from 'assert';
import { ProfileService } from '../../src/profile/profile_service';
import type { Profile } from '../../src/profile/types';

describe('#profile service bot ai validator', () => {
  it('persists useAiValidator on create and update bot', () => {
    const profiles: Profile[] = [
      {
        id: 'p1',
        name: 'Profile 1',
        exchange: 'binance',
        bots: []
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

    const created = profileService.createBot('p1', {
      name: 'AI OFF Bot',
      strategy: 'macd',
      pair: 'BTC/USDT',
      interval: '15m',
      capital: 100,
      mode: 'watch',
      useAiValidator: false
    });

    assert.strictEqual(created.useAiValidator, false);

    const updated = profileService.updateBot('p1', created.id, { useAiValidator: true });
    assert.strictEqual(updated.useAiValidator, true);
  });
});
