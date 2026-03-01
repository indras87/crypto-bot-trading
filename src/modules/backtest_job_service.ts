import crypto from 'crypto';
import { EventEmitter } from 'events';

export type BacktestJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type BacktestJobPhase = 'queued' | 'running' | 'saving' | 'done' | 'failed';
export type BacktestJobResultType = 'single' | 'multi';
export type BacktestPeriodStatus = 'queued' | 'running' | 'done' | 'failed';
export type BacktestJobEventType =
  | 'job_started'
  | 'job_progress'
  | 'timeframe_started'
  | 'timeframe_done'
  | 'timeframe_failed'
  | 'job_done'
  | 'job_failed';

export interface BacktestJobSnapshot {
  totalPeriods: number;
  completedPeriods: number;
  periodStates: Record<string, BacktestPeriodStatus>;
  partialSummaries: Record<string, Record<string, any>>;
  failedPeriods: Record<string, string>;
}

export interface BacktestJobResult {
  resultType: BacktestJobResultType;
  viewData: Record<string, any>;
}

export interface BacktestJobEvent {
  type: BacktestJobEventType;
  timestamp: number;
  data?: Record<string, any>;
}

export interface BacktestJob {
  id: string;
  type: BacktestJobResultType;
  status: BacktestJobStatus;
  phase: BacktestJobPhase;
  progressPercent: number;
  message: string;
  createdAt: number;
  startedAt?: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  result?: BacktestJobResult;
  snapshot: BacktestJobSnapshot;
}

interface JobRunnerContext {
  jobId: string;
  setProgress: (phase: BacktestJobPhase, progressPercent: number, message: string) => void;
  emitEvent: (type: BacktestJobEventType, data?: Record<string, any>) => void;
  initPeriods: (periods: string[]) => void;
  setPeriodState: (period: string, state: BacktestPeriodStatus, message?: string) => void;
  setPeriodSummary: (period: string, summary: Record<string, any>) => void;
  setPeriodDetail: (period: string, detail: Record<string, any>) => void;
  setPeriodFailure: (period: string, errorMessage: string) => void;
}

type JobRunner = (ctx: JobRunnerContext) => Promise<BacktestJobResult>;

interface InternalJob extends BacktestJob {
  runner: JobRunner;
  events: EventEmitter;
  periodDetails: Record<string, Record<string, any>>;
}

function cloneSnapshot(snapshot: BacktestJobSnapshot): BacktestJobSnapshot {
  return {
    totalPeriods: snapshot.totalPeriods,
    completedPeriods: snapshot.completedPeriods,
    periodStates: { ...snapshot.periodStates },
    partialSummaries: { ...snapshot.partialSummaries },
    failedPeriods: { ...snapshot.failedPeriods }
  };
}

export class BacktestJobService {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private runningCount = 0;
  private readonly maxConcurrentJobs: number;
  private readonly ttlMs: number;

  constructor(maxConcurrentJobs: number = 1, ttlHours: number = 6) {
    this.maxConcurrentJobs = Math.max(1, maxConcurrentJobs);
    this.ttlMs = Math.max(1, ttlHours) * 60 * 60 * 1000;
    setInterval(() => this.cleanup(), 15 * 60 * 1000);
  }

  createJob(type: BacktestJobResultType, runner: JobRunner): BacktestJob {
    const id = crypto.randomUUID();
    const now = Date.now();
    const job: InternalJob = {
      id,
      type,
      status: 'queued',
      phase: 'queued',
      progressPercent: 0,
      message: 'Queued',
      createdAt: now,
      updatedAt: now,
      runner,
      events: new EventEmitter(),
      periodDetails: {},
      snapshot: {
        totalPeriods: 0,
        completedPeriods: 0,
        periodStates: {},
        partialSummaries: {},
        failedPeriods: {}
      }
    };
    this.jobs.set(id, job);
    this.queue.push(id);
    this.drainQueue();
    return this.toPublic(job);
  }

  getJob(jobId: string): BacktestJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return this.toPublic(job);
  }

  getJobForRender(jobId: string): BacktestJob | undefined {
    return this.getJob(jobId);
  }

  getSnapshot(jobId: string): BacktestJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return cloneSnapshot(job.snapshot);
  }

  getPeriodDetail(jobId: string, period: string): Record<string, any> | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return job.periodDetails[period];
  }

  subscribe(jobId: string, listener: (event: BacktestJobEvent) => void): (() => void) | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.events.on('event', listener);
    return () => {
      job.events.off('event', listener);
    };
  }

  private toPublic(job: InternalJob): BacktestJob {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      phase: job.phase,
      progressPercent: job.progressPercent,
      message: job.message,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      result: job.result,
      snapshot: cloneSnapshot(job.snapshot)
    };
  }

  private emitEvent(job: InternalJob, type: BacktestJobEventType, data?: Record<string, any>): void {
    job.events.emit('event', {
      type,
      timestamp: Date.now(),
      data
    } as BacktestJobEvent);
  }

  private drainQueue(): void {
    while (this.runningCount < this.maxConcurrentJobs && this.queue.length > 0) {
      const jobId = this.queue.shift();
      if (!jobId) continue;
      const job = this.jobs.get(jobId);
      if (!job || job.status !== 'queued') continue;
      this.executeJob(job).catch(() => {
        // Error handled inside executeJob
      });
    }
  }

  private ensurePeriod(job: InternalJob, period: string): void {
    if (!job.snapshot.periodStates[period]) {
      job.snapshot.periodStates[period] = 'queued';
      job.snapshot.totalPeriods = Object.keys(job.snapshot.periodStates).length;
    }
  }

  private recalculateCompletedPeriods(job: InternalJob): void {
    const states = Object.values(job.snapshot.periodStates);
    job.snapshot.completedPeriods = states.filter(state => state === 'done' || state === 'failed').length;
  }

  private async executeJob(job: InternalJob): Promise<void> {
    this.runningCount++;
    job.status = 'running';
    job.phase = 'running';
    job.progressPercent = Math.max(job.progressPercent, 1);
    job.message = 'Job started';
    job.startedAt = Date.now();
    job.updatedAt = Date.now();
    this.emitEvent(job, 'job_started', { jobId: job.id, type: job.type });

    try {
      const result = await job.runner({
        jobId: job.id,
        setProgress: (phase: BacktestJobPhase, progressPercent: number, message: string) => {
          job.phase = phase;
          job.progressPercent = Math.max(0, Math.min(100, Math.floor(progressPercent)));
          job.message = message;
          job.updatedAt = Date.now();
          this.emitEvent(job, 'job_progress', {
            phase: job.phase,
            progressPercent: job.progressPercent,
            message: job.message
          });
        },
        emitEvent: (type: BacktestJobEventType, data?: Record<string, any>) => {
          this.emitEvent(job, type, data);
        },
        initPeriods: (periods: string[]) => {
          const uniqPeriods = Array.from(new Set(periods));
          job.snapshot.periodStates = {};
          for (const period of uniqPeriods) {
            job.snapshot.periodStates[period] = 'queued';
          }
          job.snapshot.totalPeriods = uniqPeriods.length;
          job.snapshot.completedPeriods = 0;
          job.snapshot.partialSummaries = {};
          job.snapshot.failedPeriods = {};
          job.updatedAt = Date.now();
          this.emitEvent(job, 'job_progress', {
            message: `Initialized ${uniqPeriods.length} timeframe(s)`,
            totalPeriods: uniqPeriods.length
          });
        },
        setPeriodState: (period: string, state: BacktestPeriodStatus, message?: string) => {
          this.ensurePeriod(job, period);
          job.snapshot.periodStates[period] = state;
          this.recalculateCompletedPeriods(job);
          job.updatedAt = Date.now();

          if (state === 'running') {
            this.emitEvent(job, 'timeframe_started', { period, message: message || `Processing ${period}` });
          } else if (state === 'done') {
            this.emitEvent(job, 'timeframe_done', {
              period,
              message: message || `${period} completed`,
              summary: job.snapshot.partialSummaries[period]
            });
          } else if (state === 'failed') {
            this.emitEvent(job, 'timeframe_failed', {
              period,
              message: message || `${period} failed`,
              error: job.snapshot.failedPeriods[period]
            });
          }
        },
        setPeriodSummary: (period: string, summary: Record<string, any>) => {
          this.ensurePeriod(job, period);
          job.snapshot.partialSummaries[period] = summary;
          job.updatedAt = Date.now();
        },
        setPeriodDetail: (period: string, detail: Record<string, any>) => {
          this.ensurePeriod(job, period);
          job.periodDetails[period] = detail;
          job.updatedAt = Date.now();
        },
        setPeriodFailure: (period: string, errorMessage: string) => {
          this.ensurePeriod(job, period);
          job.snapshot.failedPeriods[period] = errorMessage;
          job.updatedAt = Date.now();
        }
      });

      job.result = result;
      job.status = 'done';
      job.phase = 'done';
      job.progressPercent = 100;
      job.message = 'Completed';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
      this.emitEvent(job, 'job_done', { jobId: job.id, type: job.type });
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.progressPercent = Math.min(job.progressPercent, 99);
      job.message = 'Failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
      this.emitEvent(job, 'job_failed', { jobId: job.id, error: job.error });
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.drainQueue();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if ((job.status === 'done' || job.status === 'failed') && job.finishedAt && now - job.finishedAt > this.ttlMs) {
        job.events.removeAllListeners();
        this.jobs.delete(jobId);
      }
    }
  }
}
