import { BaseController, TemplateHelpers } from './base_controller';
import { ProfileService } from '../profile/profile_service';
import { TradeInfo, ClosedPositionInfo } from '../profile/types';
import express from 'express';

interface TradeHistoryStats {
  totalTrades: number;
  totalOrders: number;
  totalPositions: number;
  totalFees: number;
  totalPnL: number;
  winRate: number;
  avgHoldingTime: number;
  longWins: number;
  longLosses: number;
  shortWins: number;
  shortLosses: number;
}

interface ProfileData {
  profileId: string;
  profileName: string;
  exchange: string;
}

export class TradingHistoryController extends BaseController {
  constructor(
    templateHelpers: TemplateHelpers,
    private profileService: ProfileService
  ) {
    super(templateHelpers);
  }

  private async fetchAllData(profileId?: string, symbol?: string, limit: number = 100) {
    const profiles = this.profileService.getProfiles().filter(p => p.apiKey && p.secret);
    const filteredProfiles = profileId ? profiles.filter(p => p.id === profileId) : profiles;

    const fetchPromises = filteredProfiles.flatMap(profile => [
      this.profileService
        .fetchClosedOrders(profile.id, limit)
        .then(orders =>
          orders.map((order: any) => ({
            ...order,
            profileId: profile.id,
            profileName: profile.name,
            exchange: profile.exchange,
            dataType: 'order'
          }))
        )
        .catch(e => {
          console.log(`Failed to fetch closed orders for profile ${profile.name}: ${String(e)}`);
          return [];
        }),
      this.profileService
        .fetchMyTrades(profile.id, symbol, limit)
        .then(trades =>
          trades.map((trade: TradeInfo) => ({
            ...trade,
            profileId: profile.id,
            profileName: profile.name,
            exchange: profile.exchange,
            dataType: 'trade'
          }))
        )
        .catch(e => {
          console.log(`Failed to fetch my trades for profile ${profile.name}: ${String(e)}`);
          return [];
        }),
      this.profileService
        .fetchClosedPositions(profile.id, symbol, limit)
        .then(positions =>
          positions.map((position: ClosedPositionInfo) => ({
            ...position,
            profileId: profile.id,
            profileName: profile.name,
            exchange: profile.exchange,
            dataType: 'position'
          }))
        )
        .catch(e => {
          console.log(`Failed to fetch closed positions for profile ${profile.name}: ${String(e)}`);
          return [];
        })
    ]);

    const results = await Promise.all(fetchPromises);

    const orders: any[] = [];
    const trades: any[] = [];
    const positions: any[] = [];

    results.forEach((result, index) => {
      const typeIndex = index % 3;
      if (typeIndex === 0) orders.push(...result);
      else if (typeIndex === 1) trades.push(...result);
      else positions.push(...result);
    });

    return { orders, trades, positions };
  }

  private calculateStats(orders: any[], trades: any[], positions: any[]): TradeHistoryStats {
    const totalOrders = orders.length;
    const totalTrades = trades.length;
    const totalPositions = positions.length;

    const totalFees = orders.reduce((sum, o) => sum + (o.fee || 0), 0) + trades.reduce((sum, t) => sum + (t.fee || 0), 0);

    const totalPnL = positions.reduce((sum, p) => sum + (p.realizedPnl || 0), 0);

    const closedPositions = positions.filter(p => p.realizedPnl !== undefined);
    const profitablePositions = closedPositions.filter(p => p.realizedPnl > 0);
    const winRate = closedPositions.length > 0 ? (profitablePositions.length / closedPositions.length) * 100 : 0;

    const positionsWithDuration = positions.filter(p => p.openTimestamp && p.closeTimestamp);
    const avgHoldingTime =
      positionsWithDuration.length > 0
        ? positionsWithDuration.reduce((sum, p) => sum + (p.closeTimestamp - p.openTimestamp), 0) / positionsWithDuration.length / 1000 / 60
        : 0;

    const longPositions = positions.filter(p => p.side === 'long');
    const shortPositions = positions.filter(p => p.side === 'short');
    const longWins = longPositions.filter(p => p.realizedPnl > 0).length;
    const longLosses = longPositions.filter(p => p.realizedPnl <= 0).length;
    const shortWins = shortPositions.filter(p => p.realizedPnl > 0).length;
    const shortLosses = shortPositions.filter(p => p.realizedPnl <= 0).length;

    return {
      totalTrades,
      totalOrders,
      totalPositions,
      totalFees,
      totalPnL,
      winRate,
      avgHoldingTime,
      longWins,
      longLosses,
      shortWins,
      shortLosses
    };
  }

  private generateCsv(orders: any[], trades: any[], positions: any[], type: string): string {
    let csv = '';
    const timestamp = new Date().toISOString();

    if (type === 'orders' || type === 'all') {
      csv += '# Closed Orders\n';
      csv += 'Profile,Exchange,Symbol,Side,Type,Price,Amount,Filled,Fees,Timestamp\n';
      orders.forEach(o => {
        csv += `"${o.profileName}","${o.exchange}","${o.pair}","${o.side}","${o.type}",${o.price},${o.amount},${o.filled},${o.fee || 0},${new Date(o.timestamp).toISOString()}\n`;
      });
      csv += '\n';
    }

    if (type === 'trades' || type === 'all') {
      csv += '# My Trades\n';
      csv += 'Profile,Exchange,Symbol,Side,Type,Price,Amount,Cost,Fees,FeesCurrency,Timestamp\n';
      trades.forEach(t => {
        csv += `"${t.profileName}","${t.exchange}","${t.pair}","${t.side}","${t.type}",${t.price},${t.amount},${t.cost},${t.fee},"${t.feeCurrency}",${new Date(t.timestamp).toISOString()}\n`;
      });
      csv += '\n';
    }

    if (type === 'positions' || type === 'all') {
      csv += '# Closed Positions\n';
      csv += 'Profile,Exchange,Symbol,Side,Contracts,EntryPrice,ExitPrice,RealizedPnL,Fees,Leverage,OpenTime,CloseTime,Duration(min)\n';
      positions.forEach(p => {
        const duration = p.closeTimestamp && p.openTimestamp ? (p.closeTimestamp - p.openTimestamp) / 1000 / 60 : 0;
        csv += `"${p.profileName}","${p.exchange}","${p.symbol}","${p.side}",${p.contracts},${p.entryPrice},${p.exitPrice},${p.realizedPnl},${p.fee},${p.leverage},${new Date(p.openTimestamp).toISOString()},${new Date(p.closeTimestamp).toISOString()},${duration}\n`;
      });
    }

    return csv;
  }

  registerRoutes(router: express.Router): void {
    router.get('/trading-history', async (req: any, res: any) => {
      const profileId = req.query.profile;
      const symbol = req.query.symbol;
      const type = req.query.type || 'all';
      const limit = parseInt(req.query.limit) || 100;

      const profiles = this.profileService.getProfiles().filter(p => p.apiKey && p.secret);

      const { orders, trades, positions } = await this.fetchAllData(profileId, symbol, limit);

      const stats = this.calculateStats(orders, trades, positions);

      orders.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      trades.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      positions.sort((a, b) => (b.closeTimestamp || 0) - (a.closeTimestamp || 0));

      res.render('trading_history', {
        activePage: 'trading-history',
        title: 'Trading History | Crypto Bot',
        orders: orders.slice(0, limit),
        trades: trades.slice(0, limit),
        positions: positions.slice(0, limit),
        stats,
        profiles,
        selectedProfile: profileId || '',
        selectedSymbol: symbol || '',
        selectedType: type,
        limit,
        updatedAt: new Date().toLocaleTimeString()
      });
    });

    router.get('/trading-history/export', async (req: any, res: any) => {
      const profileId = req.query.profile;
      const symbol = req.query.symbol;
      const type = req.query.type || 'all';
      const limit = parseInt(req.query.limit) || 1000;

      const { orders, trades, positions } = await this.fetchAllData(profileId, symbol, limit);

      const csv = this.generateCsv(orders, trades, positions, type);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=trading-history-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csv);
    });
  }
}
