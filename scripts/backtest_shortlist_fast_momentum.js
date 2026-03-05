#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    input: '',
    minWinRate: 60,
    minRoi: 0,
    minTrades: 1,
    maxDd: null,
    top: 100
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const [key, value] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, argv[i + 1]];
    const consumeNext = !arg.includes('=');

    switch (key) {
      case '--input':
        args.input = value;
        break;
      case '--min-winrate':
        args.minWinRate = Number(value);
        break;
      case '--min-roi':
        args.minRoi = Number(value);
        break;
      case '--min-trades':
        args.minTrades = Number(value);
        break;
      case '--max-dd':
        args.maxDd = Number(value);
        break;
      case '--top':
        args.top = Number(value);
        break;
      default:
        break;
    }

    if (consumeNext) i += 1;
  }

  return args;
}

function num(v) {
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

function printUsage() {
  console.log(`Usage:
node scripts/backtest_shortlist_fast_momentum.js --input <json-file> [options]

Options:
  --min-winrate <number>  Minimum win rate percent (default: 60)
  --min-roi <number>      Minimum ROI percent (default: 0)
  --min-trades <number>   Minimum trades (default: 1)
  --max-dd <number>       Maximum max drawdown percent (optional)
  --top <number>          Maximum rows printed (default: 100)
`);
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.input) {
    printUsage();
    process.exit(1);
  }

  const inputFile = path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputFile)) {
    console.error(`Input file not found: ${inputFile}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const rows = (data.rows || []).filter(r => !r.error);

  const filtered = rows
    .filter(r => num(r.win_rate_pct) >= args.minWinRate)
    .filter(r => num(r.roi_pct) > args.minRoi)
    .filter(r => num(r.trades) >= args.minTrades)
    .filter(r => args.maxDd === null || num(r.max_dd_pct) <= args.maxDd)
    .sort((a, b) => num(b.roi_pct) - num(a.roi_pct) || num(b.win_rate_pct) - num(a.win_rate_pct))
    .slice(0, args.top);

  if (filtered.length === 0) {
    console.log('No rows matched the shortlist criteria.');
    return;
  }

  console.log(
    `Shortlist: WR>=${args.minWinRate}, ROI>${args.minRoi}, Trades>=${args.minTrades}${args.maxDd === null ? '' : `, MaxDD<=${args.maxDd}`}`
  );
  filtered.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.pair} ${r.period} | preset=${r.preset} trades=${r.trades} wr=${r.win_rate_pct}% roi=${r.roi_pct}% dd=${r.max_dd_pct}%`
    );
  });
}

main();
