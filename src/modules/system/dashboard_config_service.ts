import { ConfigService, DashboardConfig, DashboardPair } from './config_service';
import { normalizeDashboardConfig } from './dashboard_pair_normalizer';

export { DashboardPair, DashboardConfig };

export class DashboardConfigService {
  constructor(private configService: ConfigService) {}

  getConfig(): DashboardConfig {
    return normalizeDashboardConfig(this.configService.getDashboardConfig());
  }

  saveConfig(config: DashboardConfig): void {
    this.configService.saveDashboardConfig(normalizeDashboardConfig(config));
  }

  getPairs(): DashboardPair[] {
    return this.getConfig().pairs;
  }

  getPeriods(): string[] {
    return this.getConfig().periods;
  }
}
