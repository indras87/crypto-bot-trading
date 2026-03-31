import type { Logger } from '../modules/services';
import { PositionHistoryRepository } from '../repository';
import { ProfileService } from '../profile/profile_service';
import type { Bot, BotV2, PositionInfo, Profile } from '../profile/types';

function isFuturesPair(pair: string): boolean {
  return pair.includes(':');
}

type LiveBotLike = Pick<Bot, 'id' | 'name' | 'pair'> | Pick<BotV2, 'id' | 'name' | 'pair'>;

export class PositionHistorySyncService {
  constructor(
    private readonly profileService: ProfileService,
    private readonly positionHistoryRepository: PositionHistoryRepository,
    private readonly logger: Logger
  ) {}

  async reconcileStartup(profiles: Profile[]): Promise<void> {
    for (const profile of profiles) {
      if (!profile.apiKey || !profile.secret) {
        continue;
      }

      for (const bot of profile.bots ?? []) {
        if (bot.status === 'running' && bot.mode === 'trade' && isFuturesPair(bot.pair)) {
          await this.reconcileLiveBot(profile, bot);
        }
      }

      for (const bot of profile.botsV2 ?? []) {
        if (bot.status === 'running' && bot.executionMode === 'live' && isFuturesPair(bot.pair)) {
          await this.reconcileLiveBot(profile, bot);
        }
      }
    }
  }

  async reconcileLiveBot(profile: Profile, bot: LiveBotLike): Promise<PositionInfo | undefined> {
    const exchangePosition = await this.getExchangePosition(profile.id, bot.pair);
    const openRows = this.positionHistoryRepository
      .getOpenPositions(profile.id)
      .filter(row => row.bot_id === bot.id && row.symbol === bot.pair);

    if (!exchangePosition && openRows.length > 0) {
      this.positionHistoryRepository.reconcileOpenPositions(profile.id, bot.id, bot.pair, 'reconciled');
      this.logger.warn(
        `PositionHistorySync: reconciled ${openRows.length} stale open row(s) for ${profile.exchange}:${bot.pair} bot="${bot.name}" because exchange is flat`
      );
      return undefined;
    }

    if (exchangePosition && openRows.length === 0) {
      this.logger.warn(
        `PositionHistorySync: exchange has open ${exchangePosition.side} position for ${profile.exchange}:${bot.pair} bot="${bot.name}" but position_history is flat`
      );
      return exchangePosition;
    }

    if (exchangePosition && openRows.length > 1) {
      this.logger.warn(
        `PositionHistorySync: detected ${openRows.length} open position_history rows for ${profile.exchange}:${bot.pair} bot="${bot.name}" while exchange has one live position`
      );
      return exchangePosition;
    }

    if (exchangePosition && openRows.length === 1 && openRows[0].side !== exchangePosition.side) {
      this.logger.warn(
        `PositionHistorySync: side mismatch for ${profile.exchange}:${bot.pair} bot="${bot.name}" db=${openRows[0].side} exchange=${exchangePosition.side}`
      );
    }

    return exchangePosition;
  }

  private async getExchangePosition(profileId: string, pair: string): Promise<PositionInfo | undefined> {
    const positions = await this.profileService.fetchOpenPositions(profileId);
    return positions.find(position => position.symbol === pair && Math.abs(position.contracts) > 0);
  }
}
