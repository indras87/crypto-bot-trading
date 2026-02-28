/**
 * Backtest Controller - Web UI controller for typed strategy backtests
 */

import { BaseController, TemplateHelpers } from './base_controller';
import crypto from 'crypto';
import {
  TypedBacktestEngine,
  StrategyExecutor,
  type BacktestResult
} from '../modules/strategy/v2/typed_backtest';
import { StrategyRegistry, type StrategyName } from '../modules/strategy/v2/strategy_registry';
import type { Period } from '../strategy/strategy';
import type express from 'express';
import type { ExchangeCandleCombine } from '../modules/exchange/exchange_candle_combine';
import type { CcxtCandleWatchService } from '../modules/system/ccxt_candle_watch_service';
import type { CcxtCandlePrefillService } from '../modules/system/ccxt_candle_prefill_service';
import { BacktestRunRepository, type BacktestRunRecord, type BacktestRunQueryParams } from '../repository/backtest_run_repository';

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

interface BacktestHistoryRow {
  id?: number;
  run_group_id: string;
  run_type: 'single' | 'multi';
  exchange: string;
  symbol: string;
  displaySymbol: string;
  period: string;
  hours: number;
  strategy: string;
  use_ai: number;
  total_trades: number;
  win_rate: number;
  total_profit_percent: number;
  sharpe_ratio: number;
  max_drawdown: number;
  created_at: number;
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
    private backtestRunRepository: BacktestRunRepository,
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

    router.get('/backtest/history', async (req: express.Request, res: express.Response) => {
      try {
        const query = req.query as Record<string, string | undefined>;
        const sortByParam = query.sortBy || query.sort_by;
        const sortDirParam = query.sortDir || query.sort_dir;
        const runTypeParam = query.runType || query.run_type;
        const useAiParam = query.useAi || query.use_ai;
        const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(query.limit || '50', 10) || 50, 1), 200);
        const sortBy = sortByParam || 'roi';
        const sortDir = sortDirParam === 'asc' ? 'asc' : 'desc';

        const filterParams: BacktestRunQueryParams = {
          strategy: query.strategy || undefined,
          exchange: query.exchange || undefined,
          symbol: query.symbol || undefined,
          period: query.period || undefined,
          runType: runTypeParam as 'single' | 'multi' | undefined,
          useAi: useAiParam as '0' | '1' | undefined,
          q: query.q || undefined,
          sortBy,
          sortDir,
          page,
          limit
        };

        const [rows, total, pairs] = await Promise.all([
          this.backtestRunRepository.findWithFilters(filterParams),
          this.backtestRunRepository.countWithFilters(filterParams),
          this.getBacktestPairs()
        ]);

        const historyRows: BacktestHistoryRow[] = rows.map(row => ({
          ...row,
          displaySymbol: buildTradingViewSymbol(row.exchange, row.symbol)
        }));

        const pages = Math.max(Math.ceil(total / limit), 1);
        const exchanges = Array.from(new Set(pairs.map(pair => pair.name.split('.')[0]))).sort((a, b) => a.localeCompare(b));

        res.render('backtest_history', {
          activePage: 'backtest',
          title: 'Backtest History | Crypto Bot',
          stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
          historyRows,
          total,
          page,
          pages,
          limit,
          filters: {
            strategy: query.strategy || '',
            exchange: query.exchange || '',
            symbol: query.symbol || '',
            period: query.period || '',
            runType: runTypeParam || '',
            useAi: useAiParam || '',
            q: query.q || '',
            sortBy,
            sortDir
          },
          periods: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'],
          strategies: this.getStrategies(),
          exchanges
        });
      } catch (error) {
        console.error('Backtest history error:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
      }
    });

    // Backtest submit
    router.post('/backtest/submit', async (req: express.Request, res: express.Response) => {
      try {
        const { pair, candle_period, hours, strategy, initial_capital, options, use_ai } = req.body;
        const parsedHours = parseInt(hours, 10);
        const parsedInitialCapital = parseFloat(initial_capital) || 1000;
        const parsedUseAi = use_ai === 'on' || use_ai === 'true';
        const parsedOptions = options ? JSON.parse(options) : undefined;

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
          hours: parsedHours,
          strategy: strategy as StrategyName,
          initialCapital: parsedInitialCapital,
          options: parsedOptions,
          useAi: parsedUseAi
        });

        this.backtestRunRepository.create(this.buildBacktestRunRecord(result, {
          runGroupId: crypto.randomUUID(),
          runType: 'single',
          strategyName: strategy,
          hours: parsedHours,
          initialCapital: parsedInitialCapital,
          useAi: parsedUseAi
        }));

        // Render result
        res.render('backtest_result', {
          activePage: 'backtest',
          title: 'Backtest Results | Crypto Bot',
          stylesheet: '<link rel="stylesheet" href="/css/backtest.css?v=' + this.templateHelpers.assetVersion() + '">',
          ...this.formatResultForView(result, parsedInitialCapital)
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
        const { pair, candle_periods, hours, strategy, initial_capital, options, use_ai, multi_backtest_concurrency } = req.body;
        const parsedHours = parseInt(hours, 10);
        const parsedInitialCapital = parseFloat(initial_capital) || 1000;
        const parsedUseAi = use_ai === 'on' || use_ai === 'true';
        const parsedConcurrency = Math.max(1, Math.min(parseInt(multi_backtest_concurrency, 10) || 2, 5));
        const parsedOptions = options ? JSON.parse(options) : undefined;
        const runGroupId = crypto.randomUUID();
        const multiStartedAt = Date.now();

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
        const results = await this.runWithConcurrency(
          periods,
          parsedConcurrency,
          async (period: string) => {
            const backtestStartedAt = Date.now();
            const result = await this.runBacktest({
              exchange,
              symbol,
              period: period as Period,
              hours: parsedHours,
              strategy: strategy as StrategyName,
              initialCapital: parsedInitialCapital,
              options: parsedOptions,
              useAi: parsedUseAi
            });

            return {
              rawResult: result,
              period,
              durationMs: Date.now() - backtestStartedAt,
              ...this.formatResultForView(result, parsedInitialCapital)
            };
          }
        );

        this.backtestRunRepository.createMany(
          results.map(item =>
            this.buildBacktestRunRecord(item.rawResult, {
              runGroupId,
              runType: 'multi',
              strategyName: strategy,
              hours: parsedHours,
              initialCapital: parsedInitialCapital,
              useAi: parsedUseAi
            })
          )
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
          results: results.map(({ rawResult: _rawResult, ...viewResult }) => viewResult)
        });
        console.log(
          `[Backtest][Multi] strategy=${strategy} pair=${exchange}:${symbol} periods=${periods.join(',')} concurrency=${parsedConcurrency} total_ms=${Date.now() - multiStartedAt}`
        );
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
    const startedAt = Date.now();

    // Create strategy instance (period NOT in options - it's passed to defineIndicators)
    const strategyInstance = this.strategyRegistry.createStrategy(strategy, {
      amount_currency: initialCapital.toString(),
      ...options,
      timeframe: period
    });

    // Run backtest
    const result = await this.engine.run(strategyInstance, {
      exchange,
      symbol,
      period,
      hours,
      initialCapital,
      useAi
    });
    console.log(`[Backtest] strategy=${strategy} pair=${exchange}:${symbol} period=${period} hours=${hours} useAi=${useAi ? '1' : '0'} total_ms=${Date.now() - startedAt}`);
    return result;
  }

  /**
   * Format backtest result for view template
   */
  private formatResultForView(result: BacktestResult, initialCapital: number) {
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
        initialCapital,
        finalCapital: initialCapital * (1 + result.summary.totalProfitPercent / 100),
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

  private buildBacktestRunRecord(
    result: BacktestResult,
    options: {
      runGroupId: string;
      runType: 'single' | 'multi';
      strategyName: string;
      hours: number;
      initialCapital: number;
      useAi: boolean;
    }
  ): BacktestRunRecord {
    const summary = result.summary;

    return {
      run_group_id: options.runGroupId,
      run_type: options.runType,
      exchange: result.exchange,
      symbol: result.symbol,
      period: result.period,
      hours: options.hours,
      strategy: options.strategyName,
      strategy_options_json: JSON.stringify(result.strategyOptions || {}),
      initial_capital: options.initialCapital,
      use_ai: options.useAi ? 1 : 0,
      start_time: Math.floor(result.startTime.getTime() / 1000),
      end_time: Math.floor(result.endTime.getTime() / 1000),
      total_trades: summary.totalTrades,
      profitable_trades: summary.profitableTrades,
      losing_trades: summary.losingTrades,
      win_rate: summary.winRate,
      total_profit_percent: summary.totalProfitPercent,
      average_profit_percent: summary.averageProfitPercent,
      max_drawdown: summary.maxDrawdown,
      sharpe_ratio: summary.sharpeRatio,
      created_at: Math.floor(Date.now() / 1000)
    };
  }

  private async runWithConcurrency<TInput, TResult>(
    items: TInput[],
    concurrency: number,
    worker: (item: TInput, index: number) => Promise<TResult>
  ): Promise<TResult[]> {
    const results: TResult[] = new Array(items.length);
    let nextIndex = 0;

    const runWorker = async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex++;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    };

    const workerCount = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(new Array(workerCount).fill(0).map(() => runWorker()));
    return results;
  }
}
