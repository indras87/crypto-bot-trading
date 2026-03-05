#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const DEFAULT_PAIRS = ['binance.XRPUSDT.P', 'binance.SOLUSDT.P', 'binance.ETHUSDT.P', 'binance.BNBUSDT.P', 'binance.ADAUSDT.P'];
const DEFAULT_PERIODS = ['15m'];
const DEFAULT_PRESETS_DIR = path.resolve(process.cwd(), 'docs/backtest-presets/fast_momentum_rsi_macd');
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), 'docs/backtest-results');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.BACKTEST_BASE_URL || 'http://127.0.0.1:8080',
    strategy: 'fast_momentum_rsi_macd',
    pairs: DEFAULT_PAIRS,
    periods: DEFAULT_PERIODS,
    hours: 720,
    initialCapital: 1000,
    useAi: false,
    pollMs: 1500,
    timeoutMs: 15 * 60 * 1000,
    presetsDir: DEFAULT_PRESETS_DIR,
    presets: [],
    outDir: DEFAULT_OUT_DIR
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
      case '--pairs':
        args.pairs = value.split(',').map(v => v.trim()).filter(Boolean);
        break;
      case '--periods':
        args.periods = value.split(',').map(v => v.trim()).filter(Boolean);
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
      case '--presets-dir':
        args.presetsDir = path.resolve(process.cwd(), value);
        break;
      case '--presets':
        args.presets = value.split(',').map(v => v.trim()).filter(Boolean);
        break;
      case '--out-dir':
        args.outDir = path.resolve(process.cwd(), value);
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

function readPresets(presetsDir, selectedPresetNames = []) {
  if (!fs.existsSync(presetsDir)) {
    throw new Error(`Presets directory not found: ${presetsDir}`);
  }

  const selectedSet = new Set(selectedPresetNames);
  const files = fs
    .readdirSync(presetsDir)
    .filter(file => file.endsWith('.json'))
    .filter(file => selectedSet.size === 0 || selectedSet.has(path.basename(file, '.json')))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No preset JSON found in: ${presetsDir}`);
  }

  return files.map(file => {
    const fullPath = path.join(presetsDir, file);
    const raw = fs.readFileSync(fullPath, 'utf8');
    return {
      name: path.basename(file, '.json'),
      file,
      fullPath,
      options: JSON.parse(raw)
    };
  });
}

function getAuthHeader() {
  const user = process.env.BACKTEST_USER;
  const pass = process.env.BACKTEST_PASS;
  if (!user || !pass) return undefined;
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return `Basic ${token}`;
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
node scripts/backtest_matrix_fast_momentum.js [options]

Options:
  --base-url <url>          Backtest API base URL (default: http://127.0.0.1:8080)
  --pairs <csv>             Example: binance.XRPUSDT.P,binance.SOLUSDT.P
  --periods <csv>           Example: 15m,30m
  --hours <number>          Backtest horizon hours (default: 720)
  --initial-capital <num>   Initial capital (default: 1000)
  --use-ai <0|1|true|false> Enable AI in backtest (default: false)
  --presets-dir <path>      Preset JSON directory
  --presets <csv>           Example: tp15_sl7,15m_baseline
  --out-dir <path>          Output directory for CSV/JSON
  --poll-ms <number>        Poll interval ms (default: 1500)
  --timeout-ms <number>     Per-job timeout ms (default: 900000)
  --help, -h                Show this help

Environment:
  BACKTEST_BASE_URL
  BACKTEST_USER / BACKTEST_PASS (for basic auth)
`);
    return;
  }

  const authHeader = getAuthHeader();
  const presets = readPresets(args.presetsDir, args.presets);

  fs.mkdirSync(args.outDir, { recursive: true });

  const combos = [];
  for (const preset of presets) {
    for (const pair of args.pairs) {
      for (const period of args.periods) {
        combos.push({ preset, pair, period });
      }
    }
  }

  console.log(`[matrix] baseUrl=${args.baseUrl}`);
  console.log(`[matrix] presets=${presets.length}, pairs=${args.pairs.length}, periods=${args.periods.length}, total_jobs=${combos.length}`);

  const rows = [];
  let done = 0;
  let successCount = 0;
  let failedCount = 0;

  for (const combo of combos) {
    const payload = {
      pair: combo.pair,
      candle_period: combo.period,
      hours: String(args.hours),
      strategy: args.strategy,
      initial_capital: String(args.initialCapital),
      options: JSON.stringify(combo.preset.options),
      use_ai: args.useAi ? '1' : '0'
    };

    console.log(`[submit] preset=${combo.preset.name} pair=${combo.pair} period=${combo.period}`);

    let jobId = '';
    try {
      const created = await postJob(args.baseUrl, authHeader, payload);
      jobId = created.jobId;

      const status = await waitJobDone(args.baseUrl, authHeader, jobId, args.pollMs, args.timeoutMs);
      if (status.status === 'failed') {
        failedCount += 1;
        rows.push({
          created_at: new Date().toISOString(),
          preset: combo.preset.name,
          pair: combo.pair,
          period: combo.period,
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
        console.log(`[fail] preset=${combo.preset.name} pair=${combo.pair} period=${combo.period} reason=${status.error || 'job_failed'}`);
      } else {
        const summary = status?.result?.viewData?.summary;
        const trades = summary?.trades || {};
        successCount += 1;

        rows.push({
          created_at: new Date().toISOString(),
          preset: combo.preset.name,
          pair: combo.pair,
          period: combo.period,
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
        console.log(
          `[ok] preset=${combo.preset.name} pair=${combo.pair} period=${combo.period} trades=${trades.total ?? ''} roi=${toPercent(summary?.netProfit)}`
        );
      }
    } catch (error) {
      failedCount += 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      rows.push({
        created_at: new Date().toISOString(),
        preset: combo.preset.name,
        pair: combo.pair,
        period: combo.period,
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
      console.log(`[fail] preset=${combo.preset.name} pair=${combo.pair} period=${combo.period} reason=${errorMessage}`);
    }

    done += 1;
    console.log(`[progress] ${done}/${combos.length} done`);
  }

  const stamp = nowStamp();
  const csvFile = path.join(args.outDir, `fast_momentum_matrix_${stamp}.csv`);
  const jsonFile = path.join(args.outDir, `fast_momentum_matrix_${stamp}.json`);

  fs.writeFileSync(csvFile, buildCsv(rows), 'utf8');
  fs.writeFileSync(
    jsonFile,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: args.baseUrl,
        strategy: args.strategy,
        presetsDir: args.presetsDir,
        pairs: args.pairs,
        periods: args.periods,
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
  console.log(`[summary] total=${combos.length} success=${successCount} failed=${failedCount}`);

  if (successCount === 0) {
    process.exitCode = 1;
  }
}

run().catch(error => {
  console.error('[fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
