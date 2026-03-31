import moment from 'moment';
import crypto from 'crypto';
import os from 'os';
import { Notify } from '../notify/notify';
import { Logger, LogsRepository, TickerLogRepository } from './services';
import { BotRunner } from '../strategy/bot_runner';
import { BotRunnerV2 } from '../strategy/bot_runner_v2';
import { PositionHistorySyncService } from '../strategy/position_history_sync_service';
import { ProfileService } from '../profile/profile_service';

export class Trade {
  constructor(
    private notify: Notify,
    private logger: Logger,
    private logsRepository: LogsRepository,
    private tickerLogRepository: TickerLogRepository,
    private profileService: ProfileService,
    private positionHistorySyncService: PositionHistorySyncService,
    private botRunner: BotRunner,
    private botRunnerV2: BotRunnerV2
  ) {}

  start(): void {
    this.logger.debug('Trade module started');

    process.on('SIGINT', async () => {
      // force exit in any case
      setTimeout(() => {
        process.exit();
      }, 7500);

      process.exit();
    });

    const instanceId = crypto.randomBytes(4).toString('hex');
    const message = `Start: ${instanceId} - ${os.hostname()} - ${os.platform()} - ${moment().format()}`;
    this.notify.send(message);

    void (async () => {
      try {
        await this.positionHistorySyncService.reconcileStartup(this.profileService.getProfiles());
      } catch (err) {
        this.logger.error(`Trade: startup position history reconciliation failed: ${String(err)}`);
      }

      this.botRunner.start();
      this.botRunnerV2.start();
    })();

    // Log cleanup cronjob
    setInterval(async () => {
      await this.logsRepository.cleanOldLogEntries();
      await this.tickerLogRepository.cleanOldLogEntries();
      this.logger.debug('Logs: Cleanup old entries');
    }, 86455000);
  }
}
