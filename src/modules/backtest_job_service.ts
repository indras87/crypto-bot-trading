import crypto from 'crypto';

export type BacktestJobStatus = 'queued' | 'running' | 'done' | 'failed';
export type BacktestJobPhase = 'queued' | 'running' | 'saving' | 'done' | 'failed';
export type BacktestJobResultType = 'single' | 'multi';

export interface BacktestJobResult {
  resultType: BacktestJobResultType;
  viewData: Record<string, any>;
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
}

interface JobRunnerContext {
  setProgress: (phase: BacktestJobPhase, progressPercent: number, message: string) => void;
}

type JobRunner = (ctx: JobRunnerContext) => Promise<BacktestJobResult>;

interface InternalJob extends BacktestJob {
  runner: JobRunner;
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
      runner
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
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return this.toPublic(job);
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
      result: job.result
    };
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

  private async executeJob(job: InternalJob): Promise<void> {
    this.runningCount++;
    job.status = 'running';
    job.phase = 'running';
    job.progressPercent = Math.max(job.progressPercent, 1);
    job.message = 'Job started';
    job.startedAt = Date.now();
    job.updatedAt = Date.now();

    try {
      const result = await job.runner({
        setProgress: (phase: BacktestJobPhase, progressPercent: number, message: string) => {
          job.phase = phase;
          job.progressPercent = Math.max(0, Math.min(100, Math.floor(progressPercent)));
          job.message = message;
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
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.progressPercent = Math.min(job.progressPercent, 99);
      job.message = 'Failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.finishedAt = Date.now();
      job.updatedAt = Date.now();
    } finally {
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.drainQueue();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      if ((job.status === 'done' || job.status === 'failed') && job.finishedAt && now - job.finishedAt > this.ttlMs) {
        this.jobs.delete(jobId);
      }
    }
  }
}
