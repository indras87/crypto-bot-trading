import assert from 'assert';
import { DashboardConfigService } from '../../../src/modules/system/dashboard_config_service';

describe('#DashboardConfigService Binance futures normalization', () => {
  it('normalizes legacy Binance perpetual pairs when reading config', () => {
    const configService = {
      getDashboardConfig: () => ({
        periods: ['5m'],
        pairs: [{ exchange: 'binance', symbol: 'BTC/USDT:USDT' }]
      }),
      saveDashboardConfig: () => {}
    } as any;

    const service = new DashboardConfigService(configService);
    const config = service.getConfig();

    assert.deepStrictEqual(config, {
      periods: ['5m'],
      pairs: [{ exchange: 'binanceusdm', symbol: 'BTC/USDT:USDT' }]
    });
  });

  it('normalizes legacy Binance perpetual pairs before saving config', () => {
    let savedConfig: any;
    const configService = {
      getDashboardConfig: () => ({ periods: [], pairs: [] }),
      saveDashboardConfig: (config: any) => {
        savedConfig = config;
      }
    } as any;

    const service = new DashboardConfigService(configService);

    service.saveConfig({
      periods: ['15m'],
      pairs: [
        { exchange: 'binance', symbol: 'BTC/USDT:USDT' },
        { exchange: 'binance', symbol: 'ETH/USDT' }
      ]
    });

    assert.deepStrictEqual(savedConfig, {
      periods: ['15m'],
      pairs: [
        { exchange: 'binanceusdm', symbol: 'BTC/USDT:USDT' },
        { exchange: 'binance', symbol: 'ETH/USDT' }
      ]
    });
  });
});
