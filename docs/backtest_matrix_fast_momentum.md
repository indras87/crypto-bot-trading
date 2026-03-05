# Fast Momentum RSI MACD - Backtest Matrix Workflow

Dokumen ini untuk menjalankan batch backtest otomatis berdasarkan preset JSON.

## 1) Preset yang dipakai

Lokasi preset:

- `docs/backtest-presets/fast_momentum_rsi_macd/15m_baseline.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/15m_tight_risk.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/15m_loose_risk.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/15m_fast_reentry.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/dd_cap_12_balanced.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/dd_cap_12_strict.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/dd_cap_10_ultra_strict.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/dd_small_sl_balanced.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/dd_small_sl_strict.json`
- `docs/backtest-presets/fast_momentum_rsi_macd/mode_recommendations.json`

Semua preset sudah mengikuti logika terbaru:

- Entry long: RSI cross ke `>= 70` + MACD histogram `> 0`
- Exit long: fixed take profit `2%` dari harga entry
- Entry short: RSI cross ke `<= 30` + MACD histogram `< 0`
- Exit short: fixed take profit `2%` dari harga entry
- Tanpa filter volume

Preset `dd_cap_*` memakai mode protektif:

- Entry RSI tetap ketat (70/30 atau lebih ketat)
- Exit fixed TP tetap `2%`
- Emergency stop loss fix `9%`
- Cooldown lebih panjang untuk mengurangi overtrading

Preset `dd_small_sl_*` dipakai untuk mode DD ketat:

- Exit fixed TP tetap `2%`
- Emergency stop loss kecil `3% - 4%`
- Entry threshold lebih ketat + cooldown untuk kurangi overtrading

## 2) Menjalankan matrix backtest

Pastikan web bot sudah jalan (`npm start` atau `npm run start:dev`) lalu jalankan:

```bash
node scripts/backtest_matrix_fast_momentum.js \
  --base-url http://127.0.0.1:8080 \
  --pairs binance.XRPUSDT.P,binance.SOLUSDT.P,binance.ETHUSDT.P,binance.BNBUSDT.P,binance.ADAUSDT.P \
  --periods 15m \
  --hours 720
```

Jika dashboard memakai basic-auth:

```bash
BACKTEST_USER=your_user BACKTEST_PASS=your_pass \
node scripts/backtest_matrix_fast_momentum.js --periods 15m --hours 720
```

## 3) Output hasil

Script menghasilkan file:

- `docs/backtest-results/fast_momentum_matrix_YYYYMMDD_HHMMSS.csv`
- `docs/backtest-results/fast_momentum_matrix_YYYYMMDD_HHMMSS.json`

Untuk mode per pair/timeframe:

- `docs/backtest-results/fast_momentum_mode_<mode>_YYYYMMDD_HHMMSS.csv`
- `docs/backtest-results/fast_momentum_mode_<mode>_YYYYMMDD_HHMMSS.json`

Template kolom CSV ada di:

- `docs/backtest-results/template_fast_momentum_matrix.csv`

## 4) Parameter penting script

- `--pairs` daftar pair dipisah koma
- `--periods` daftar timeframe dipisah koma
- `--hours` panjang data backtest
- `--presets-dir` lokasi folder preset JSON
- `--poll-ms` interval polling status job
- `--timeout-ms` timeout per job

## 5) Rekomendasi evaluasi

Urutkan hasil berdasarkan:

1. `roi_pct` tinggi
2. `max_dd_pct` rendah
3. `profit_factor` > 1.2
4. `trades` minimal 20 untuk reliabilitas awal

Lalu validasi ulang pemenang preset di 2160 jam (90 hari) untuk cek stabilitas.

## 6) Jalankan 2 mode rekomendasi

Mode file:

- `docs/backtest-presets/fast_momentum_rsi_macd/mode_recommendations.json`

Jalankan mode `high_winrate_sl9`:

```bash
npm run backtest:mode:fast-momentum -- --mode high_winrate_sl9 --hours 720
```

Jalankan mode `tight_dd_small_sl`:

```bash
npm run backtest:mode:fast-momentum -- --mode tight_dd_small_sl --hours 720
```

Jika pakai basic-auth:

```bash
BACKTEST_USER=your_user BACKTEST_PASS=your_pass \\
npm run backtest:mode:fast-momentum -- --mode high_winrate_sl9 --hours 720
```
