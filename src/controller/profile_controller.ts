import { BaseController, TemplateHelpers } from './base_controller';
import { ProfileService } from '../profile/profile_service';
import { ProfilePairService } from '../modules/profile_pair_service';
import { Profile } from '../profile/types';
import { StrategyRegistry } from '../modules/strategy/v2/strategy_registry';
import { CcxtCandleWatchService } from '../modules/system/ccxt_candle_watch_service';
import { AdaptivePolicyService } from '../ai/adaptive_policy_service';
import express from 'express';

export class ProfileController extends BaseController {
  constructor(
    templateHelpers: TemplateHelpers,
    private profileService: ProfileService,
    private pairService: ProfilePairService,
    private strategyRegistry: StrategyRegistry,
    private ccxtCandleWatchService: CcxtCandleWatchService,
    private adaptivePolicyService: AdaptivePolicyService
  ) {
    super(templateHelpers);
  }

  registerRoutes(router: express.Router): void {
    // Profile UI Routes
    router.get('/profiles', this.index.bind(this));
    router.get('/profiles/new', this.newForm.bind(this));
    router.get('/profiles/:id', this.view.bind(this));
    router.get('/profiles/:id/edit', this.editForm.bind(this));
    router.post('/profiles', this.create.bind(this));
    router.post('/profiles/:id', this.update.bind(this));
    router.post('/profiles/:id/delete', this.deleteProfile.bind(this));

    // Bot UI Routes
    router.get('/profiles/:id/bots/new', this.newBotForm.bind(this));
    router.get('/profiles/:id/bots/:botId/edit', this.editBotForm.bind(this));
    router.post('/profiles/:id/bots', this.createBot.bind(this));
    router.post('/profiles/:id/bots/:botId', this.updateBot.bind(this));
    router.post('/profiles/:id/bots/:botId/delete', this.deleteBot.bind(this));
    router.get('/profiles/:id/bots-v2/new', this.newBotV2Form.bind(this));
    router.get('/profiles/:id/bots-v2/:botId/edit', this.editBotV2Form.bind(this));
    router.post('/profiles/:id/bots-v2', this.createBotV2.bind(this));
    router.post('/profiles/:id/bots-v2/:botId', this.updateBotV2.bind(this));
    router.post('/profiles/:id/bots-v2/:botId/delete', this.deleteBotV2.bind(this));

    // API Routes
    router.get('/api/profiles/:id/balances', this.getBalances.bind(this));
    router.get('/api/profiles/:id/orders', this.getOrders.bind(this));
    router.get('/api/profiles/:id/positions', this.getPositions.bind(this));
    router.post('/api/profiles/:id/positions/close', this.closePosition.bind(this));
    router.get('/api/profiles/:id/orders/:pair/cancel/:orderId', this.cancelOrder.bind(this));
    router.get('/api/exchanges', this.getExchanges.bind(this));
    router.get('/api/profiles/:id/pairs', this.getPairs.bind(this));
    router.get('/api/strategies', this.getStrategies.bind(this));
    router.get('/api/ai/policy-status-v2', this.getAiPolicyStatusV2.bind(this));
  }

  private async index(req: express.Request, res: express.Response): Promise<void> {
    const profiles = this.profileService.getProfiles();
    this.render(res, 'profile/index', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'Profiles | Crypto Bot',
      profiles,
    });
  }

  private async view(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }

    this.render(res, 'profile/view', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: `${profile.name} | Crypto Bot`,
      profile,
    });
  }

  private async newForm(req: express.Request, res: express.Response): Promise<void> {
    const exchanges = this.profileService.getSupportedExchanges();
    this.render(res, 'profile/form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'New Profile | Crypto Bot',
      profile: null,
      exchanges,
      isEdit: false,
    });
  }

  private async editForm(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);
    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }
    const exchanges = this.profileService.getSupportedExchanges();
    this.render(res, 'profile/form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'Edit Profile | Crypto Bot',
      profile,
      exchanges,
      isEdit: true,
    });
  }

  private async create(req: express.Request, res: express.Response): Promise<void> {
    const { name, exchange, apiKey, secret } = req.body;
    this.profileService.createProfile({
      name,
      exchange,
      apiKey,
      secret,
    });
    res.redirect('/profiles');
  }

  private async update(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const { name, exchange, apiKey, secret } = req.body;

    this.profileService.updateProfile(id, { name, exchange, apiKey, secret });
    res.redirect('/profiles/' + id);
  }

  private async deleteProfile(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    this.profileService.deleteProfile(id);
    res.redirect('/profiles');
  }

  private async getBalances(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    if (!profile.apiKey || !profile.secret) {
      res.status(400).json({ error: 'API credentials not configured' });
      return;
    }

    try {
      const balances = await this.profileService.fetchBalances(profile);
      res.json({ success: true, balances });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch balances' });
    }
  }

  private async getOrders(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    if (!profile.apiKey || !profile.secret) {
      res.status(400).json({ error: 'API credentials not configured' });
      return;
    }

    try {
      const [open, closed] = await Promise.all([
        this.profileService.fetchOpenOrders(id),
        this.profileService.fetchClosedOrders(id, 10)
      ]);
      res.json({ success: true, open, closed });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch orders' });
    }
  }

  private async cancelOrder(req: express.Request, res: express.Response): Promise<void> {
    const { id, pair, orderId } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    try {
      await this.profileService.cancelOrder(id, orderId, decodeURIComponent(pair));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to cancel order' });
    }
  }

  private async getPositions(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    if (!profile.apiKey || !profile.secret) {
      res.status(400).json({ error: 'API credentials not configured' });
      return;
    }

    try {
      const positions = await this.profileService.fetchOpenPositions(id);
      res.json({ success: true, positions });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch positions' });
    }
  }

  private async closePosition(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const { symbol, type } = req.body;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    try {
      await this.profileService.closePosition(id, decodeURIComponent(symbol), type as 'limit' | 'market');
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to close position' });
    }
  }

  private async getExchanges(req: express.Request, res: express.Response): Promise<void> {
    const exchanges = this.profileService.getSupportedExchanges();
    res.json({ exchanges });
  }

  // API endpoints for searchable dropdowns

  private async getPairs(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    try {
      const { pairs } = await this.pairService.getAllPairs([profile]);
      res.json({ success: true, pairs: pairs.map(p => p.pair) });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to fetch pairs' });
    }
  }

  private async getStrategies(req: express.Request, res: express.Response): Promise<void> {
    const strategies = this.strategyRegistry.getAllStrategyInfo().map(info => {
      // Get default options by creating an instance with empty options
      const StrategyClass = this.strategyRegistry.getStrategyClass(info.name);
      // @ts-ignore
      const instance = new StrategyClass({});
      const defaultOptions = instance.getOptions?.() || {};

      return {
        ...info,
        defaultOptions
      };
    });
    res.json({ success: true, strategies });
  }

  // Bot handlers - Plain form submissions

  private async newBotForm(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }

    const strategies = this.getStrategiesWithDefaults();
    const pairs = await this.getPairsForProfile(profile);

    this.render(res, 'profile/bot_form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'New Bot | Crypto Bot',
      profile,
      bot: null,
      strategies,
      pairs,
      isEdit: false,
    });
  }

  private async editBotForm(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }

    const bot = this.profileService.getBot(id, botId);
    if (!bot) {
      res.status(404).send('Bot not found');
      return;
    }

    const strategies = this.getStrategiesWithDefaults();
    const pairs = await this.getPairsForProfile(profile);

    this.render(res, 'profile/bot_form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'Edit Bot | Crypto Bot',
      profile,
      bot,
      strategies,
      pairs,
      isEdit: true,
    });
  }

  private async getPairsForProfile(profile: Profile): Promise<string[]> {
    try {
      const { pairs } = await this.pairService.getAllPairs([profile]);
      return pairs.map(p => p.pair);
    } catch (error) {
      console.error('Failed to fetch pairs:', error);
      return [];
    }
  }

  private getStrategiesWithDefaults() {
    return this.strategyRegistry.getAllStrategyInfo().map(info => {
      const StrategyClass = this.strategyRegistry.getStrategyClass(info.name);
      // @ts-ignore
      const instance = new StrategyClass({});
      const defaultOptions = instance.getOptions?.() || {};

      return {
        ...info,
        defaultOptions
      };
    });
  }

  private async createBot(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const { name, strategy, pair, interval, capital, mode, status, options, useAiValidator } = req.body;

    let parsedOptions: Record<string, any> | undefined;
    if (options && options.trim()) {
      try {
        parsedOptions = JSON.parse(options);
      } catch (e) {
        // Invalid JSON, ignore
      }
    }

    this.profileService.createBot(id, {
      name,
      strategy,
      pair,
      interval,
      capital: parseFloat(capital),
      mode,
      status: status === 'on' ? 'running' : 'stopped',
      useAiValidator: useAiValidator === 'on',
      options: parsedOptions,
    });

    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async updateBot(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    const { name, strategy, pair, interval, capital, mode, status, options, useAiValidator } = req.body;

    let parsedOptions: Record<string, any> | undefined;
    if (options && options.trim()) {
      try {
        parsedOptions = JSON.parse(options);
      } catch (e) {
        // Invalid JSON, ignore
      }
    }

    this.profileService.updateBot(id, botId, {
      name,
      strategy,
      pair,
      interval,
      capital: parseFloat(capital),
      mode,
      status: status === 'on' ? 'running' : 'stopped',
      useAiValidator: useAiValidator === 'on',
      options: parsedOptions,
    });

    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async deleteBot(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    this.profileService.deleteBot(id, botId);
    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async newBotV2Form(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }

    const strategies = this.getStrategiesWithDefaults();
    const pairs = await this.getPairsForProfile(profile);

    this.render(res, 'profile/bot_v2_form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'New Bot V2 | Crypto Bot',
      profile,
      bot: null,
      strategies,
      pairs,
      isEdit: false,
    });
  }

  private async editBotV2Form(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    const profile = this.profileService.getProfile(id);

    if (!profile) {
      res.status(404).send('Profile not found');
      return;
    }

    const bot = this.profileService.getBotV2(id, botId);
    if (!bot) {
      res.status(404).send('Bot V2 not found');
      return;
    }

    const strategies = this.getStrategiesWithDefaults();
    const pairs = await this.getPairsForProfile(profile);

    this.render(res, 'profile/bot_v2_form', {
      activePage: 'settings', activeSettingsPage: 'profiles',
      title: 'Edit Bot V2 | Crypto Bot',
      profile,
      bot,
      strategies,
      pairs,
      isEdit: true,
    });
  }

  private async createBotV2(req: express.Request, res: express.Response): Promise<void> {
    const { id } = req.params;
    const { name, strategy, pair, interval, capital, status, options, useAiValidator } = req.body;

    let parsedOptions: Record<string, any> | undefined;
    if (options && options.trim()) {
      try {
        parsedOptions = JSON.parse(options);
      } catch {
        // Invalid JSON, ignore
      }
    }

    this.profileService.createBotV2(id, {
      name,
      strategy,
      pair,
      interval,
      capital: parseFloat(capital),
      status: status === 'on' ? 'running' : 'stopped',
      useAiValidator: useAiValidator === 'on',
      executionMode: req.body.executionMode === 'live' ? 'live' : 'paper',
      adaptiveEnabled: req.body.adaptiveEnabled === 'on',
      adaptiveUpdateEveryTrades: Math.max(5, parseInt(req.body.adaptiveUpdateEveryTrades, 10) || 20),
      maxDrawdownPct: Math.max(1, parseFloat(req.body.maxDrawdownPct) || 12),
      futuresOnlyLongShort: req.body.futuresOnlyLongShort === 'on',
      aiMinConfidence: Math.max(0.5, Math.min(0.95, parseFloat(req.body.aiMinConfidence) || 0.7)),
      options: parsedOptions
    });

    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async updateBotV2(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    const { name, strategy, pair, interval, capital, status, options, useAiValidator } = req.body;

    let parsedOptions: Record<string, any> | undefined;
    if (options && options.trim()) {
      try {
        parsedOptions = JSON.parse(options);
      } catch {
        // Invalid JSON, ignore
      }
    }

    this.profileService.updateBotV2(id, botId, {
      name,
      strategy,
      pair,
      interval,
      capital: parseFloat(capital),
      status: status === 'on' ? 'running' : 'stopped',
      useAiValidator: useAiValidator === 'on',
      executionMode: req.body.executionMode === 'live' ? 'live' : 'paper',
      adaptiveEnabled: req.body.adaptiveEnabled === 'on',
      adaptiveUpdateEveryTrades: Math.max(5, parseInt(req.body.adaptiveUpdateEveryTrades, 10) || 20),
      maxDrawdownPct: Math.max(1, parseFloat(req.body.maxDrawdownPct) || 12),
      futuresOnlyLongShort: req.body.futuresOnlyLongShort === 'on',
      aiMinConfidence: Math.max(0.5, Math.min(0.95, parseFloat(req.body.aiMinConfidence) || 0.7)),
      options: parsedOptions
    });

    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async deleteBotV2(req: express.Request, res: express.Response): Promise<void> {
    const { id, botId } = req.params;
    this.profileService.deleteBotV2(id, botId);
    this.ccxtCandleWatchService.restart();
    res.redirect('/profiles/' + id);
  }

  private async getAiPolicyStatusV2(req: express.Request, res: express.Response): Promise<void> {
    const profileId = String(req.query.profileId || '');
    const botId = String(req.query.botId || '');

    if (!profileId || !botId) {
      res.status(400).json({ error: 'profileId and botId are required' });
      return;
    }

    const bot = this.profileService.getBotV2(profileId, botId);
    if (!bot) {
      res.status(404).json({ error: 'Bot V2 not found' });
      return;
    }

    const status = this.adaptivePolicyService.getPolicyStatus(profileId, bot);
    res.json({ success: true, status });
  }
}
