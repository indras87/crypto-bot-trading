#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const DEFAULT_MODE_FILE = path.resolve(process.cwd(), 'docs/backtest-presets/fast_momentum_rsi_macd/mode_recommendations.json');
const DEFAULT_PRESETS_DIR = path.resolve(process.cwd(), 'docs/backtest-presets/fast_momentum_rsi_macd');
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'docs/backtest-results');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.BACKTEST_BASE_URL || 'http://127.0.0.1:8080',
    strategy: 'fast_momentum_rsi_macd',
    mode: 'high_winrate_sl9',
    modeFile: DEFAULT_MODE_FILE,
    presetsDir: DEFAULT_PRESETS_DIR,
    outDir: DEFAULT_OUT_DIR,
    hours: 720,
    initialCapital: 1000,
    useAi: false,
    pollMs: 1500,
    timeoutMs: 15 * 60 * 1000
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;

    const [key, value] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, argv[i + 1]];
    const consumeNext = !arg.includes('=');

    switch (key) {
      case '--base-url':
        args.baseUrl = value;
        break;
      case '--strategy':
        args.strategy = value;
        break;
      case '--mode':
        args.mode = value;
        break;
      case '--mode-file':
        args.modeFile = path.resolve(process.cwd(), value);
        break;
      case '--presets-dir':
        args.presetsDir = path.resolve(process.cwd(), value);
        break;
      case '--out-dir':
        args.outDir = path.resolve(process.cwd(), value);
        break;
      case '--hours':
        args.hours = Number(value);
        break;
      case '--initial-capital':
        args.initialCapital = Number(value);
        break;
      case '--use-ai':
        args.useAi = value === 'true' || value === '1';
        break;
      case '--poll-ms':
        args.pollMs = Number(value);
        break;
      case '--timeout-ms':
        args.timeoutMs = Number(value);
        break;
      default:
        break;
    }

    if (consumeNext) i += 1;
  }

  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return value.toFixed(4);
}

function getAuthHeader() {
  const user = process.env.BACKTEST_USER;
  const pass = process.env.BACKTEST_PASS;
  if (!user || !pass) return undefined;
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return `Basic ${token}`;
}

function loadModeJobs(modeFile, modeName) {
  if (!fs.existsSync(modeFile)) {
    throw new Error(`Mode file not found: ${modeFile}`);
  }

  const raw = fs.readFileSync(modeFile, 'utf8');
  const parsed = JSON.parse(raw);
  const mode = parsed?.modes?.[modeName];
  if (!mode) {
    const knownModes = Object.keys(parsed?.modes || {}).join(', ') || '-';
    throw new Error(`Mode '${modeName}' not found in ${modeFile}. Available: ${knownModes}`);
  }

  const jobs = Array.isArray(mode.jobs) ? mode.jobs : [];
  if (jobs.length === 0) {
    throw new Error(`Mode '${modeName}' has no jobs`);
  }

  return jobs;
}

function loadPresetOptions(presetsDir, presetName) {
  const file = path.join(presetsDir, `${presetName}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Preset not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function postJob(baseUrl, authHeader, payload) {
  const headers = {
    'Content-Type': 'application/json'
  };
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(`${baseUrl}/api/backtest/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Create job failed ${response.status}: ${text}`);
  }

  return response.json();
}

async function getJobStatus(baseUrl, authHeader, jobId) {
  const headers = {};
  if (authHeader) headers.Authorization = authHeader;

  const response = await fetch(`${baseUrl}/api/backtest/jobs/${jobId}`, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Get job failed ${response.status}: ${text}`);
  }

  return response.json();
}

async function waitJobDone(baseUrl, authHeader, jobId, pollMs, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getJobStatus(baseUrl, authHeader, jobId);

    if (status.status === 'done' || status.status === 'failed') {
      return status;
    }

    await sleep(pollMs);
  }

  throw new Error(`Job timeout after ${timeoutMs}ms (jobId=${jobId})`);
}

function buildCsv(rows) {
  const headers = [
    'created_at',
    'mode',
    'preset',
    'pair',
    'period',
    'hours',
    'strategy',
    'trades',
    'wins',
    'losses',
    'win_rate_pct',
    'roi_pct',
    'sharpe',
    'profit_factor',
    'expectancy_pct',
    'calmar',
    'max_dd_pct',
    'confidence',
    'job_id',
    'error'
  ];

  const lines = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map(key => {
      const raw = row[key] ?? '';
      const value = String(raw).replace(/"/g, '""');
      return `"${value}"`;
    });
    lines.push(values.join(','));
  }

  return `${lines.join('\n')}\n`;
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
node scripts/backtest_mode_fast_momentum.js [options]

Options:
  --mode <name>             Mode key in mode_recommendations.json
  --mode-file <path>        Mode recommendations file
  --presets-dir <path>      Preset JSON directory
  --base-url <url>          Backtest API base URL (default: http://127.0.0.1:8080)
  --hours <number>          Backtest horizon hours (default: 720)
  --initial-capital <num>   Initial capital (default: 1000)
  --use-ai <0|1|true|false> Enable AI in backtest (default: false)
  --poll-ms <number>        Poll interval ms (default: 1500)
  --timeout-ms <number>     Per-job timeout ms (default: 900000)
  --out-dir <path>          Output directory for CSV/JSON
  --help, -h                Show this help

Environment:
  BACKTEST_BASE_URL
  BACKTEST_USER / BACKTEST_PASS (for basic auth)
`);
    return;
  }

  const authHeader = getAuthHeader();
  const jobs = loadModeJobs(args.modeFile, args.mode).map(job => ({
    ...job,
    options: loadPresetOptions(args.presetsDir, job.preset)
  }));

  fs.mkdirSync(args.outDir, { recursive: true });

  console.log(`[mode] baseUrl=${args.baseUrl}`);
  console.log(`[mode] mode=${args.mode}, jobs=${jobs.length}`);

  const rows = [];
  let successCount = 0;
  let failedCount = 0;

  for (let idx = 0; idx < jobs.length; idx += 1) {
    const job = jobs[idx];
    const payload = {
      pair: job.pair,
      candle_period: job.period,
      hours: String(args.hours),
      strategy: args.strategy,
      initial_capital: String(args.initialCapital),
      options: JSON.stringify(job.options),
      use_ai: args.useAi ? '1' : '0'
    };

    console.log(`[submit] mode=${args.mode} preset=${job.preset} pair=${job.pair} period=${job.period}`);

    let jobId = '';
    try {
      const created = await postJob(args.baseUrl, authHeader, payload);
      jobId = created.jobId;

      const status = await waitJobDone(args.baseUrl, authHeader, jobId, args.pollMs, args.timeoutMs);
      if (status.status === 'failed') {
        failedCount += 1;
        rows.push({
          created_at: new Date().toISOString(),
          mode: args.mode,
          preset: job.preset,
          pair: job.pair,
          period: job.period,
          hours: args.hours,
          strategy: args.strategy,
          trades: '',
          wins: '',
          losses: '',
          win_rate_pct: '',
          roi_pct: '',
          sharpe: '',
          profit_factor: '',
          expectancy_pct: '',
          calmar: '',
          max_dd_pct: '',
          confidence: '',
          job_id: jobId,
          error: status.error || 'job_failed'
        });
        console.log(`[fail] mode=${args.mode} preset=${job.preset} pair=${job.pair} period=${job.period} reason=${status.error || 'job_failed'}`);
      } else {
        const summary = status?.result?.viewData?.summary;
        const trades = summary?.trades || {};
        successCount += 1;

        rows.push({
          created_at: new Date().toISOString(),
          mode: args.mode,
          preset: job.preset,
          pair: job.pair,
          period: job.period,
          hours: args.hours,
          strategy: args.strategy,
          trades: trades.total ?? '',
          wins: trades.profitableCount ?? '',
          losses: trades.lossMakingCount ?? '',
          win_rate_pct: toPercent(trades.profitabilityPercent),
          roi_pct: toPercent(summary?.netProfit),
          sharpe: toPercent(summary?.sharpeRatio),
          profit_factor: toPercent(summary?.profitFactor),
          expectancy_pct: toPercent(summary?.expectancyPercent),
          calmar: toPercent(summary?.calmarRatio),
          max_dd_pct: toPercent(summary?.maxDrawdown),
          confidence: summary?.metricsConfidence || '',
          job_id: jobId,
          error: ''
        });

        console.log(`[ok] mode=${args.mode} preset=${job.preset} pair=${job.pair} period=${job.period} trades=${trades.total ?? ''} roi=${toPercent(summary?.netProfit)}`);
      }
    } catch (error) {
      failedCount += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      rows.push({
        created_at: new Date().toISOString(),
        mode: args.mode,
        preset: job.preset,
        pair: job.pair,
        period: job.period,
        hours: args.hours,
        strategy: args.strategy,
        trades: '',
        wins: '',
        losses: '',
        win_rate_pct: '',
        roi_pct: '',
        sharpe: '',
        profit_factor: '',
        expectancy_pct: '',
        calmar: '',
        max_dd_pct: '',
        confidence: '',
        job_id: jobId,
        error: errorMessage
      });
      console.log(`[fail] mode=${args.mode} preset=${job.preset} pair=${job.pair} period=${job.period} reason=${errorMessage}`);
    }

    console.log(`[progress] ${idx + 1}/${jobs.length} done`);
  }

  const stamp = nowStamp();
  const fileBase = `fast_momentum_mode_${args.mode}_${stamp}`;
  const csvFile = path.join(args.outDir, `${fileBase}.csv`);
  const jsonFile = path.join(args.outDir, `${fileBase}.json`);

  fs.writeFileSync(csvFile, buildCsv(rows), 'utf8');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: args.baseUrl,
        strategy: args.strategy,
        mode: args.mode,
        modeFile: args.modeFile,
        presetsDir: args.presetsDir,
        hours: args.hours,
        initialCapital: args.initialCapital,
        useAi: args.useAi,
        rows
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[done] csv=${csvFile}`);
  console.log(`[done] json=${jsonFile}`);
  console.log(`[summary] total=${jobs.length} success=${successCount} failed=${failedCount}`);

  if (successCount === 0) {
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error('[fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
