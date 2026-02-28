/**
 * Backtest Controller - Web UI controller for typed strategy backtests
 */

import { BaseController, TemplateHelpers } from './base_controller';
import {
  TypedBacktestEngine,
  StrategyExecutor,
  type BacktestResult,
  type BacktestSummary,
  type BacktestTrade,
  type BacktestRow
} from '../modules/strategy/v2/typed_backtest';
import { StrategyRegistry, type StrategyName } from '../modules/strategy/v2/strategy_registry';
import type { Period } from '../strategy/strategy';
import type express from 'express';
import type { ExchangeCandleCombine } from '../modules/exchange/exchange_candle_combine';
import type { CcxtCandleWatchService } from '../modules/system/ccxt_candle_watch_service';
import type { CcxtCandlePrefillService } from '../modules/system/ccxt_candle_prefill_service';

// Chart data format for the view
interface CandleChartData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  signals: { signal: string }[];
}

import { buildTradingViewSymbol } from '../utils/tradingview_util';

export interface BacktestV2Pair {
  name: string;
  displayName: string;
  options: string[];
}

export interface BacktestV2StrategyInfo {
  name: string;
  displayName: string;
  description: string;
  defaultOptions: Record<string, any>;
}

export interface BacktestV2Request {
  exchange: string;
  symbol: string;
  period: Period;
  hours: number;
  strategy: StrategyName;
  initialCapital: number;
  options?: Record<string, any>;
  useAi?: boolean;
}

/**
 * Build candle chart data from backtest result (presentation logic)
 */
function buildCandleChartData(result: BacktestResult): CandleChartData[] {
  const candleByTime = new Map(result.candlesAsc.map(c => [c.time, c]));

  return result.rows.map(row => {
    const signals: { signal: string }[] = [];
    if (row.signal) {
      signals.push({ signal: row.signal });
    }

    const candle = candleByTime.get(row.time);
    return {
      date: new Date(row.time * 1000).toISOString(),
      open: candle?.open ?? row.price,
      high: candle?.high ?? row.price,
      low: candle?.low ?? row.price,
      close: row.price,
      volume: candle?.volume ?? 0,
      signals
    };
  });
}

import { AiService } from '../ai/ai_service';

export class BacktestController extends BaseController {
  private engine: TypedBacktestEngine;

  constructor(
    templateHelpers: TemplateHelpers,
    exchangeCandleCombine: ExchangeCandleCombine,
    private strategyRegistry: StrategyRegistry,
    strategyExecutor: StrategyExecutor,
    private ccxtCandleWatchService: CcxtCandleWatchService,
    private aiService: AiService,
    ccxtCandlePrefillService?: CcxtCandlePrefillService
  ) {
    super(templateHelpers);
    this.engine = new TypedBacktestEngine(exchangeCandleCombine, strategyExecutor, ccxtCandlePrefillService);
  }

  registerRoutes(router: express.Router): void {
    // ... rest of the code ...
    // Backtest form page
    router.get('/backtest', async (req: express.Request, res: express.Response) => {
      res.render('backtest', {
        activePage: 'backtest',
        title: 'Backtesting | Crypto Bot',
        stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
        strategies: this.getStrategies(),
        pairs: await this.getBacktestPairs(),
        periods: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']
      });
    });

    // Backtest submit
    router.post('/backtest/submit', async (req: express.Request, res: express.Response) => {
      try {
        const { pair, candle_period, hours, strategy, initial_capital, options, use_ai } = req.body;

        // Parse pair (format: "exchange.symbol")
        const [exchange, symbol] = pair.split('.');

        // Validate strategy
        if (!this.strategyRegistry.isValidStrategy(strategy)) {
          res.status(400).json({ error: `Invalid strategy: ${strategy}` });
          return;
        }

        // Run backtest
        const result = await this.runBacktest({
          exchange,
          symbol,
          period: candle_period as Period,
          hours: parseInt(hours, 10),
          strategy: strategy as StrategyName,
          initialCapital: parseFloat(initial_capital) || 1000,
          options: options ? JSON.parse(options) : undefined,
          useAi: use_ai === 'on' || use_ai === 'true'
        });

        // Render result
        res.render('backtest_result', {
          activePage: 'backtest',
          title: 'Backtest Results | Crypto Bot',
          stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
          ...this.formatResultForView(result)
        });
      } catch (error) {
        console.error('Backtest error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    // API endpoint for programmatic access
    router.post('/api/backtest', async (req: express.Request, res: express.Response) => {
      try {
        const { exchange, symbol, period, hours, strategy, initialCapital, options, useAi } = req.body as BacktestV2Request;

        // Validate
        if (!this.strategyRegistry.isValidStrategy(strategy)) {
          res.status(400).json({ error: `Invalid strategy: ${strategy}` });
          return;
        }

        const result = await this.runBacktest({
          exchange,
          symbol,
          period: period as Period,
          hours,
          strategy: strategy as StrategyName,
          initialCapital: initialCapital || 1000,
          options,
          useAi
        });

        res.json(result);
      } catch (error) {
        console.error('API backtest error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    // Get available strategies (API)
    router.get('/api/backtest/strategies', (_req: express.Request, res: express.Response) => {
      res.json(this.getStrategies());
    });

    // AI Analysis of result
    router.post('/backtest/analyze-result', async (req: express.Request, res: express.Response) => {
      try {
        const result = req.body;
        const analysis = await this.aiService.analyzeBacktest(result);
        res.json({ analysis });
      } catch (error) {
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    // Multi-timeframe backtest form page
    router.get('/backtest/multi', async (req: express.Request, res: express.Response) => {
      res.render('backtest_multi', {
        activePage: 'backtest',
        title: 'Multi Timeframe Backtesting | Crypto Bot',
        stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
        strategies: this.getStrategies(),
        pairs: await this.getBacktestPairs(),
        periods: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']
      });
    });

    // Multi-timeframe backtest submit
    router.post('/backtest/multi/submit', async (req: express.Request, res: express.Response) => {
      try {
        const { pair, candle_periods, hours, strategy, initial_capital, options, use_ai } = req.body;

        // Parse periods (can be array or single value)
        const periods = Array.isArray(candle_periods) ? candle_periods : [candle_periods];

        // Validate max 5 periods
        if (periods.length > 5) {
          res.status(400).json({ error: 'Maximum 5 periods allowed' });
          return;
        }

        if (periods.length === 0) {
          res.status(400).json({ error: 'At least one period must be selected' });
          return;
        }

        // Parse pair (format: "exchange.symbol")
        const [exchange, symbol] = pair.split('.');

        // Validate strategy
        if (!this.strategyRegistry.isValidStrategy(strategy)) {
          res.status(400).json({ error: `Invalid strategy: ${strategy}` });
          return;
        }

        // Run backtests for each period
        const results = await Promise.all(
          periods.map(async (period: string) => {
            const result = await this.runBacktest({
              exchange,
              symbol,
              period: period as Period,
              hours: parseInt(hours, 10),
              strategy: strategy as StrategyName,
              initialCapital: parseFloat(initial_capital) || 1000,
              options: options ? JSON.parse(options) : undefined,
              useAi: use_ai === 'on' || use_ai === 'true'
            });

            return {
              period,
              ...this.formatResultForView(result)
            };
          })
        );

        // Render results
        res.render('backtest_multi_result', {
          activePage: 'backtest',
          title: 'Multi Timeframe Backtest Results | Crypto Bot',
          stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
          strategyName: strategy,
          exchange,
          symbol,
          displaySymbol: buildTradingViewSymbol(exchange, symbol),
          results
        });
      } catch (error) {
        console.error('Multi-timeframe backtest error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });
  }

  /**
   * Get all available v2 strategies
   */
  getStrategies(): BacktestV2StrategyInfo[] {
    return this.strategyRegistry.getAllStrategyInfo().map(info => {
      // Get default options by creating an instance with empty options
      const StrategyClass = this.strategyRegistry.getStrategyClass(info.name);
      // @ts-ignore - Create with empty options to get defaults
      const instance = new StrategyClass({});
      const defaultOptions = instance.getOptions?.() || {};

      return {
        ...info,
        defaultOptions
      };
    });
  }

  /**
   * Get available pairs for backtest dropdown
   */
  async getBacktestPairs(): Promise<BacktestV2Pair[]> {
    return this.ccxtCandleWatchService
      .getWatchedPairs()
      .map(pair => ({
        name: `${pair.exchange}.${pair.symbol}`,
        displayName: `${pair.exchange}: ${buildTradingViewSymbol(pair.exchange, pair.symbol)}`,
        options: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Run a backtest with the v2 engine
   */
  async runBacktest(request: BacktestV2Request): Promise<BacktestResult> {
    const { exchange, symbol, period, hours, strategy, initialCapital, options, useAi } = request;

    // Create strategy instance (period NOT in options - it's passed to defineIndicators)
    const strategyInstance = this.strategyRegistry.createStrategy(strategy, {
      amount_currency: initialCapital.toString(),
      ...options
    });

    // Run backtest
    return this.engine.run(strategyInstance, {
      exchange,
      symbol,
      period,
      hours,
      initialCapital,
      useAi
    });
  }

  /**
   * Format backtest result for view template
   */
  private formatResultForView(result: BacktestResult) {
    return {
      strategyName: result.strategyName,
      strategyOptions: result.strategyOptions,
      exchange: result.exchange,
      symbol: result.symbol,
      displaySymbol: buildTradingViewSymbol(result.exchange, result.symbol),
      period: result.period,
      startTime: result.startTime,
      endTime: result.endTime,

      // Summary
      summary: {
        netProfit: result.summary.totalProfitPercent,
        initialCapital: 1000, // TODO: track this
        finalCapital: 1000 * (1 + result.summary.totalProfitPercent / 100),
        sharpeRatio: result.summary.sharpeRatio,
        averagePNLPercent: result.summary.averageProfitPercent,
        trades: {
          total: result.summary.totalTrades,
          profitableCount: result.summary.profitableTrades,
          lossMakingCount: result.summary.losingTrades,
          profitabilityPercent: result.summary.winRate
        },
        maxDrawdown: result.summary.maxDrawdown
      },

      // Trades for table
      trades: result.trades.map(trade => ({
        entryTime: new Date(trade.entryTime * 1000),
        exitTime: new Date(trade.exitTime * 1000),
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        side: trade.side,
        profitPercent: trade.profitPercent,
        profitAbsolute: trade.profitAbsolute,
        aiConfirmation: trade.aiConfirmation
      })),

      // Rows for signal history table
      rows: result.rows,

      // Indicator keys for display
      indicatorKeys: result.indicatorKeys,

      // Candles for chart (JSON string for data attribute) - built from raw data
      candles: JSON.stringify(buildCandleChartData(result))
    };
  }
}
