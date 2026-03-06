interface Statement {
  all(parameters?: any): any[];
  get(parameters?: any): any;
  run(parameters?: any): any;
}

interface Database {
  prepare(sql: string): Statement;
}

export interface AiSignalDecisionInput {
  profileId: string;
  botId: string;
  exchange: string;
  symbol: string;
  timeframe: string;
  signal: string;
  action: string;
  confidence: number;
  confirmed: boolean;
  riskLevel?: string;
  reasonCode?: string;
  reasoning?: string;
  indicatorJson?: string;
  createdAt: number;
}

export interface RiskStateInput {
  profileId: string;
  botId: string;
  maxDrawdownPct: number;
  equityPeak: number;
  currentEquity: number;
  currentDrawdownPct: number;
  paused: boolean;
  pauseReason?: string;
  updatedAt: number;
}

export interface PolicySnapshotInput {
  profileId: string;
  botId: string;
  policyVersion: number;
  aiMinConfidence: number;
  strategyOptionsJson?: string;
  objectiveScore: number;
  source: string;
  createdAt: number;
}

export interface PolicyUpdateInput {
  profileId: string;
  botId: string;
  previousVersion: number;
  nextVersion: number;
  previousConfidence: number;
  nextConfidence: number;
  objectiveBefore: number;
  objectiveAfter: number;
  accepted: boolean;
  reason?: string;
  createdAt: number;
}

export class AiPolicyRepository {
  constructor(private db: Database) {}

  insertSignalDecision(input: AiSignalDecisionInput): void {
    this.db
      .prepare(`
      INSERT INTO ai_signal_decisions (
        profile_id, bot_id, exchange, symbol, timeframe, signal, action, confidence, confirmed,
        risk_level, reason_code, reasoning, indicator_json, created_at
      ) VALUES (
        $profile_id, $bot_id, $exchange, $symbol, $timeframe, $signal, $action, $confidence, $confirmed,
        $risk_level, $reason_code, $reasoning, $indicator_json, $created_at
      )
    `)
      .run({
        profile_id: input.profileId,
        bot_id: input.botId,
        exchange: input.exchange,
        symbol: input.symbol,
        timeframe: input.timeframe,
        signal: input.signal,
        action: input.action,
        confidence: input.confidence,
        confirmed: input.confirmed ? 1 : 0,
        risk_level: input.riskLevel || null,
        reason_code: input.reasonCode || null,
        reasoning: input.reasoning || null,
        indicator_json: input.indicatorJson || null,
        created_at: input.createdAt
      });
  }

  upsertRiskState(input: RiskStateInput): void {
    this.db
      .prepare(`
      INSERT INTO bot_risk_state (
        profile_id, bot_id, max_drawdown_pct, equity_peak, current_equity, current_drawdown_pct, paused, pause_reason, updated_at
      ) VALUES (
        $profile_id, $bot_id, $max_drawdown_pct, $equity_peak, $current_equity, $current_drawdown_pct, $paused, $pause_reason, $updated_at
      )
      ON CONFLICT(profile_id, bot_id) DO UPDATE SET
        max_drawdown_pct = excluded.max_drawdown_pct,
        equity_peak = excluded.equity_peak,
        current_equity = excluded.current_equity,
        current_drawdown_pct = excluded.current_drawdown_pct,
        paused = excluded.paused,
        pause_reason = excluded.pause_reason,
        updated_at = excluded.updated_at
    `)
      .run({
        profile_id: input.profileId,
        bot_id: input.botId,
        max_drawdown_pct: input.maxDrawdownPct,
        equity_peak: input.equityPeak,
        current_equity: input.currentEquity,
        current_drawdown_pct: input.currentDrawdownPct,
        paused: input.paused ? 1 : 0,
        pause_reason: input.pauseReason || null,
        updated_at: input.updatedAt
      });
  }

  getRiskState(profileId: string, botId: string): any | undefined {
    return this.db
      .prepare(
        `SELECT * FROM bot_risk_state WHERE profile_id = $profile_id AND bot_id = $bot_id LIMIT 1`
      )
      .get({ profile_id: profileId, bot_id: botId });
  }

  insertPolicySnapshot(input: PolicySnapshotInput): void {
    this.db
      .prepare(`
      INSERT INTO policy_snapshots (
        profile_id, bot_id, policy_version, ai_min_confidence, strategy_options_json, objective_score, source, created_at
      ) VALUES (
        $profile_id, $bot_id, $policy_version, $ai_min_confidence, $strategy_options_json, $objective_score, $source, $created_at
      )
    `)
      .run({
        profile_id: input.profileId,
        bot_id: input.botId,
        policy_version: input.policyVersion,
        ai_min_confidence: input.aiMinConfidence,
        strategy_options_json: input.strategyOptionsJson || null,
        objective_score: input.objectiveScore,
        source: input.source,
        created_at: input.createdAt
      });
  }

  getLatestPolicySnapshot(profileId: string, botId: string): any | undefined {
    return this.db
      .prepare(
        `SELECT * FROM policy_snapshots WHERE profile_id = $profile_id AND bot_id = $bot_id ORDER BY policy_version DESC LIMIT 1`
      )
      .get({ profile_id: profileId, bot_id: botId });
  }

  insertPolicyUpdate(input: PolicyUpdateInput): void {
    this.db
      .prepare(`
      INSERT INTO policy_updates (
        profile_id, bot_id, previous_version, next_version, previous_confidence, next_confidence,
        objective_before, objective_after, accepted, reason, created_at
      ) VALUES (
        $profile_id, $bot_id, $previous_version, $next_version, $previous_confidence, $next_confidence,
        $objective_before, $objective_after, $accepted, $reason, $created_at
      )
    `)
      .run({
        profile_id: input.profileId,
        bot_id: input.botId,
        previous_version: input.previousVersion,
        next_version: input.nextVersion,
        previous_confidence: input.previousConfidence,
        next_confidence: input.nextConfidence,
        objective_before: input.objectiveBefore,
        objective_after: input.objectiveAfter,
        accepted: input.accepted ? 1 : 0,
        reason: input.reason || null,
        created_at: input.createdAt
      });
  }

  getRecentClosedTrades(profileId: string, botId: string, limit: number): any[] {
    return this.db
      .prepare(
        `SELECT * FROM position_history
         WHERE profile_id = $profile_id AND bot_id = $bot_id AND status = 'closed'
         ORDER BY closed_at DESC
         LIMIT $limit`
      )
      .all({ profile_id: profileId, bot_id: botId, limit });
  }

  countClosedTrades(profileId: string, botId: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) as total FROM position_history WHERE profile_id = $profile_id AND bot_id = $bot_id AND status = 'closed'`
      )
      .get({ profile_id: profileId, bot_id: botId });
    return Number(row?.total || 0);
  }
}
