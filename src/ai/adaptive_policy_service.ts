import type { Logger } from '../modules/services';
import type { BotV2 } from '../profile/types';
import { AiPolicyRepository } from '../repository/ai_policy_repository';

export interface EffectiveBotAiConfig {
  executionMode: 'paper' | 'live';
  adaptiveEnabled: boolean;
  adaptiveUpdateEveryTrades: number;
  maxDrawdownPct: number;
  futuresOnlyLongShort: boolean;
  aiMinConfidence: number;
}

export interface PolicyStatusResponse {
  profileId: string;
  botId: string;
  paused: boolean;
  pauseReason?: string;
  currentDrawdownPct: number;
  maxDrawdownPct: number;
  closedTrades: number;
  currentPolicyVersion: number;
  aiMinConfidence: number;
  executionMode: 'paper' | 'live';
  adaptiveEnabled: boolean;
  adaptiveUpdateEveryTrades: number;
  liveEligible: boolean;
  liveEligibilityReason?: string;
}

export interface ClosedTradeInput {
  realizedPnl: number;
}

const DEFAULTS: EffectiveBotAiConfig = {
  executionMode: 'paper',
  adaptiveEnabled: true,
  adaptiveUpdateEveryTrades: 20,
  maxDrawdownPct: 12,
  futuresOnlyLongShort: true,
  aiMinConfidence: 0.7
};

export class AdaptivePolicyService {
  constructor(
    private repo: AiPolicyRepository,
    private logger: Logger
  ) {}

  getEffectiveConfig(bot: BotV2): EffectiveBotAiConfig {
    return {
      executionMode: bot.executionMode || DEFAULTS.executionMode,
      adaptiveEnabled: bot.adaptiveEnabled ?? DEFAULTS.adaptiveEnabled,
      adaptiveUpdateEveryTrades: Math.max(5, bot.adaptiveUpdateEveryTrades || DEFAULTS.adaptiveUpdateEveryTrades),
      maxDrawdownPct: Math.max(1, bot.maxDrawdownPct || DEFAULTS.maxDrawdownPct),
      futuresOnlyLongShort: bot.futuresOnlyLongShort ?? DEFAULTS.futuresOnlyLongShort,
      aiMinConfidence: this.clamp(bot.aiMinConfidence ?? DEFAULTS.aiMinConfidence, 0.5, 0.95)
    };
  }

  ensureInitialPolicy(profileId: string, bot: BotV2): void {
    const existing = this.repo.getLatestPolicySnapshot(profileId, bot.id);
    if (existing) return;

    const cfg = this.getEffectiveConfig(bot);
    this.repo.insertPolicySnapshot({
      profileId,
      botId: bot.id,
      policyVersion: 1,
      aiMinConfidence: cfg.aiMinConfidence,
      strategyOptionsJson: JSON.stringify(bot.options || {}),
      objectiveScore: 0,
      source: 'bootstrap',
      createdAt: Math.floor(Date.now() / 1000)
    });
  }

  getPolicyMinConfidence(profileId: string, bot: BotV2): number {
    this.ensureInitialPolicy(profileId, bot);
    const latest = this.repo.getLatestPolicySnapshot(profileId, bot.id);
    if (!latest) return this.getEffectiveConfig(bot).aiMinConfidence;
    return this.clamp(Number(latest.ai_min_confidence || 0.7), 0.5, 0.95);
  }

  recordSignalDecision(input: {
    profileId: string;
    bot: BotV2;
    exchange: string;
    signal: string;
    symbol: string;
    timeframe: string;
    action: string;
    confidence: number;
    confirmed: boolean;
    riskLevel?: string;
    reasonCode?: string;
    reasoning?: string;
    debug?: Record<string, any>;
  }): void {
    this.repo.insertSignalDecision({
      profileId: input.profileId,
      botId: input.bot.id,
      exchange: input.exchange,
      symbol: input.symbol,
      timeframe: input.timeframe,
      signal: input.signal,
      action: input.action,
      confidence: this.clamp(input.confidence || 0, 0, 1),
      confirmed: input.confirmed,
      riskLevel: input.riskLevel,
      reasonCode: input.reasonCode,
      reasoning: input.reasoning,
      indicatorJson: input.debug ? JSON.stringify(input.debug) : undefined,
      createdAt: Math.floor(Date.now() / 1000)
    });
  }

  isPaused(profileId: string, botId: string): boolean {
    const state = this.repo.getRiskState(profileId, botId);
    return !!state?.paused;
  }

  recordClosedTrade(profileId: string, bot: BotV2, trade: ClosedTradeInput): any {
    this.ensureInitialPolicy(profileId, bot);
    const cfg = this.getEffectiveConfig(bot);
    const now = Math.floor(Date.now() / 1000);
    const existing = this.repo.getRiskState(profileId, bot.id);
    const baselineEquity = existing ? Number(existing.current_equity || bot.capital) : bot.capital;
    const peak = existing ? Number(existing.equity_peak || bot.capital) : bot.capital;

    const currentEquity = baselineEquity + trade.realizedPnl;
    const nextPeak = Math.max(peak, currentEquity);
    const drawdownPct = nextPeak <= 0 ? 0 : ((nextPeak - currentEquity) / nextPeak) * 100;
    const pauseBecauseDd = drawdownPct > cfg.maxDrawdownPct;
    const paused = pauseBecauseDd || !!existing?.paused;
    const pauseReason = pauseBecauseDd
      ? `Max drawdown exceeded (${drawdownPct.toFixed(2)}% > ${cfg.maxDrawdownPct.toFixed(2)}%)`
      : existing?.pause_reason || null;

    this.repo.upsertRiskState({
      profileId,
      botId: bot.id,
      maxDrawdownPct: cfg.maxDrawdownPct,
      equityPeak: nextPeak,
      currentEquity,
      currentDrawdownPct: drawdownPct,
      paused,
      pauseReason: pauseReason || undefined,
      updatedAt: now
    });

    if (cfg.adaptiveEnabled) {
      this.tryUpdatePolicy(profileId, bot, cfg);
    }

    return this.repo.getRiskState(profileId, bot.id);
  }

  getPolicyStatus(profileId: string, bot: BotV2): PolicyStatusResponse {
    this.ensureInitialPolicy(profileId, bot);
    const cfg = this.getEffectiveConfig(bot);
    const risk = this.repo.getRiskState(profileId, bot.id);
    const latestPolicy = this.repo.getLatestPolicySnapshot(profileId, bot.id);
    const closedTrades = this.repo.countClosedTrades(profileId, bot.id);
    const liveGate = this.getLiveGateStatus(profileId, bot);

    return {
      profileId,
      botId: bot.id,
      paused: !!risk?.paused,
      pauseReason: risk?.pause_reason || undefined,
      currentDrawdownPct: Number(risk?.current_drawdown_pct || 0),
      maxDrawdownPct: Number(risk?.max_drawdown_pct || cfg.maxDrawdownPct),
      closedTrades,
      currentPolicyVersion: Number(latestPolicy?.policy_version || 1),
      aiMinConfidence: Number(latestPolicy?.ai_min_confidence || cfg.aiMinConfidence),
      executionMode: cfg.executionMode,
      adaptiveEnabled: cfg.adaptiveEnabled,
      adaptiveUpdateEveryTrades: cfg.adaptiveUpdateEveryTrades,
      liveEligible: liveGate.eligible,
      liveEligibilityReason: liveGate.reason
    };
  }

  getLiveGateStatus(profileId: string, bot: BotV2): { eligible: boolean; reason?: string } {
    const recent = this.repo.getRecentClosedTrades(profileId, bot.id, 100);
    if (recent.length < 100) {
      return { eligible: false, reason: `Need at least 100 closed trades, current ${recent.length}` };
    }

    let winPnl = 0;
    let lossPnl = 0;
    let totalPnl = 0;
    let equity = bot.capital;
    let peak = bot.capital;
    let maxDd = 0;

    for (const t of recent.slice().reverse()) {
      const pnl = Number(t.realized_pnl || 0);
      totalPnl += pnl;
      if (pnl >= 0) {
        winPnl += pnl;
      } else {
        lossPnl += Math.abs(pnl);
      }
      equity += pnl;
      peak = Math.max(peak, equity);
      const dd = peak <= 0 ? 0 : ((peak - equity) / peak) * 100;
      maxDd = Math.max(maxDd, dd);
    }

    const profitFactor = lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? 10 : 0;
    const roiPct = bot.capital > 0 ? (totalPnl / bot.capital) * 100 : 0;
    const calmar = maxDd > 0 ? roiPct / maxDd : roiPct;

    if (maxDd > (bot.maxDrawdownPct ?? DEFAULTS.maxDrawdownPct)) {
      return { eligible: false, reason: `Max DD too high (${maxDd.toFixed(2)}%)` };
    }
    if (profitFactor < 1.2) {
      return { eligible: false, reason: `Profit factor ${profitFactor.toFixed(2)} < 1.2` };
    }
    if (calmar <= 0) {
      return { eligible: false, reason: `Calmar ${calmar.toFixed(2)} <= 0` };
    }

    return { eligible: true };
  }

  private tryUpdatePolicy(profileId: string, bot: BotV2, cfg: EffectiveBotAiConfig): void {
    const totalClosed = this.repo.countClosedTrades(profileId, bot.id);
    if (totalClosed === 0 || totalClosed % cfg.adaptiveUpdateEveryTrades !== 0) return;

    const latest = this.repo.getLatestPolicySnapshot(profileId, bot.id);
    if (!latest) return;

    const trades = this.repo.getRecentClosedTrades(profileId, bot.id, cfg.adaptiveUpdateEveryTrades).slice().reverse();
    if (trades.length < cfg.adaptiveUpdateEveryTrades) return;

    let totalProfit = 0;
    let wins = 0;
    let winPnl = 0;
    let lossPnl = 0;
    let equity = bot.capital;
    let peak = bot.capital;
    let maxWindowDd = 0;

    for (const t of trades) {
      const pnl = Number(t.realized_pnl || 0);
      totalProfit += pnl;
      if (pnl >= 0) {
        wins += 1;
        winPnl += pnl;
      } else {
        lossPnl += Math.abs(pnl);
      }

      equity += pnl;
      peak = Math.max(peak, equity);
      const dd = peak <= 0 ? 0 : ((peak - equity) / peak) * 100;
      maxWindowDd = Math.max(maxWindowDd, dd);
    }

    const profitFactor = lossPnl > 0 ? winPnl / lossPnl : winPnl > 0 ? 10 : 0;
    const returnPct = bot.capital > 0 ? (totalProfit / bot.capital) * 100 : 0;
    const calmar = maxWindowDd > 0 ? returnPct / maxWindowDd : returnPct;
    const objective = calmar + (profitFactor - 1) * 0.5 - maxWindowDd * 0.02;
    const previousObjective = Number(latest.objective_score || 0);
    const currentConfidence = Number(latest.ai_min_confidence || cfg.aiMinConfidence);
    const winRate = trades.length > 0 ? wins / trades.length : 0;

    let nextConfidence = currentConfidence;
    if (winRate < 0.45) {
      nextConfidence = this.clamp(currentConfidence + 0.05, 0.55, 0.9);
    } else if (winRate > 0.6 && maxWindowDd < cfg.maxDrawdownPct * 0.6) {
      nextConfidence = this.clamp(currentConfidence - 0.03, 0.55, 0.9);
    }

    const accepted = objective > previousObjective + 0.05 && maxWindowDd <= cfg.maxDrawdownPct;
    const nextVersion = Number(latest.policy_version || 1) + 1;
    const now = Math.floor(Date.now() / 1000);

    this.repo.insertPolicyUpdate({
      profileId,
      botId: bot.id,
      previousVersion: Number(latest.policy_version || 1),
      nextVersion,
      previousConfidence: currentConfidence,
      nextConfidence,
      objectiveBefore: previousObjective,
      objectiveAfter: objective,
      accepted,
      reason: accepted
        ? `Accepted: objective improved to ${objective.toFixed(4)}`
        : `Rejected: objective=${objective.toFixed(4)}, maxWindowDd=${maxWindowDd.toFixed(2)}%`,
      createdAt: now
    });

    if (!accepted) return;

    this.repo.insertPolicySnapshot({
      profileId,
      botId: bot.id,
      policyVersion: nextVersion,
      aiMinConfidence: nextConfidence,
      strategyOptionsJson: JSON.stringify(bot.options || {}),
      objectiveScore: objective,
      source: 'adaptive',
      createdAt: now
    });

    this.logger.info(
      `[AdaptivePolicy] profile=${profileId} bot=${bot.id} version=${nextVersion} min_confidence=${nextConfidence.toFixed(2)} objective=${objective.toFixed(4)}`
    );
  }

  private clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  }
}
