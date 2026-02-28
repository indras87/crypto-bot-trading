# SMC + RSI Divergence Strategy

Strategi trading berbasis **Smart Money Concepts (SMC)** yang dikombinasikan dengan **RSI Divergence** untuk mengidentifikasi titik pembalikan (reversal) dengan akurasi tinggi.

## Konsep Utama

Strategi ini **tidak** masuk hanya karena RSI menyentuh level Overbought (>70) atau Oversold (<30). Sebaliknya, strategi menunggu **ketidaksesuaian antara pergerakan harga dan momentum (Divergence)** di dalam zona Supply/Demand yang valid.

### Komponen Utama

| Komponen | Fungsi |
|----------|--------|
| **EMA 50 / EMA 200** | Menentukan arah tren (proxy H1 trend) |
| **Pivot Points High/Low** | Mengidentifikasi zona Supply & Demand |
| **RSI Divergence** | Mendeteksi pelemahan momentum sebelum entry |
| **Engulfing Candle** | Konfirmasi pembalikan di zona |
| **RSI Based MA** | Filter momentum tambahan (RSI vs SMA-nya) |
| **ATR** | Kalkulasi Stop Loss & Take Profit otomatis |

---

## Logika Entry

### LONG (Buy)

Semua kondisi berikut harus terpenuhi **secara bersamaan**:

1. ✅ **Uptrend**: EMA 50 > EMA 200
2. ✅ **Zona Demand**: Harga berada di dekat Swing Low (dalam radius ATR × `zone_atr_multiplier`)
3. ✅ **Bullish RSI Divergence**: Harga membuat Lower Low, tapi RSI membuat Higher Low
4. ✅ **Bullish Engulfing**: Candle bullish menelan body candle bearish sebelumnya
5. ✅ **RSI > RSI-MA**: Garis RSI di atas garis MA-nya (momentum naik)

### SHORT (Sell)

Semua kondisi berikut harus terpenuhi **secara bersamaan**:

1. ✅ **Downtrend**: EMA 50 < EMA 200
2. ✅ **Zona Supply**: Harga berada di dekat Swing High (dalam radius ATR × `zone_atr_multiplier`)
3. ✅ **Bearish RSI Divergence**: Harga membuat Higher High, tapi RSI membuat Lower High
4. ✅ **Bearish Engulfing**: Candle bearish menelan body candle bullish sebelumnya
5. ✅ **RSI < RSI-MA**: Garis RSI di bawah garis MA-nya (momentum turun)

---

## Logika Exit

### Auto-Close (Trend Reversal)
- Posisi **LONG** ditutup otomatis ketika EMA 50 turun di bawah EMA 200 (tren berbalik bearish)
- Posisi **SHORT** ditutup otomatis ketika EMA 50 naik di atas EMA 200 (tren berbalik bullish)

### Stop Loss & Take Profit (ATR-based)
- **Stop Loss LONG**: Di bawah level Demand Zone − (ATR × `atr_sl_multiplier`)
- **Take Profit LONG**: Entry + (Entry − SL) × `rr_ratio`
- **Stop Loss SHORT**: Di atas level Supply Zone + (ATR × `atr_sl_multiplier`)
- **Take Profit SHORT**: Entry − (SL − Entry) × `rr_ratio`

> **Catatan**: SL/TP dihitung dan ditampilkan di debug output. Untuk eksekusi otomatis SL/TP, gunakan opsi `stop_loss` dan `take_profit` (dalam persen) di konfigurasi bot.

---

## Manajemen Risiko

- **Risk:Reward Ratio**: Minimum 1:3 (default)
- **Satu entry per zona**: Tidak ada re-entry di zona yang sama
- **Re-entry**: Hanya setelah posisi ditutup dan zona baru terbentuk

---

## Konfigurasi

### Parameter Default

```json
{
  "ema_fast_length": 50,
  "ema_slow_length": 200,
  "rsi_length": 14,
  "rsi_ma_length": 14,
  "atr_length": 14,
  "pivot_left": 5,
  "pivot_right": 3,
  "divergence_lookback": 8,
  "zone_atr_multiplier": 1.5,
  "atr_sl_multiplier": 0.5,
  "rr_ratio": 3
}
```

### Deskripsi Parameter

| Parameter | Default | Deskripsi |
|-----------|---------|-----------|
| `ema_fast_length` | 50 | Period EMA cepat (tren jangka pendek) |
| `ema_slow_length` | 200 | Period EMA lambat (tren jangka panjang) |
| `rsi_length` | 14 | Period RSI |
| `rsi_ma_length` | 14 | Period SMA yang diterapkan pada nilai RSI |
| `atr_length` | 14 | Period ATR untuk kalkulasi SL/TP |
| `pivot_left` | 5 | Jumlah candle kiri untuk pivot point |
| `pivot_right` | 3 | Jumlah candle kanan untuk pivot point |
| `divergence_lookback` | 8 | Jumlah candle untuk deteksi divergence |
| `zone_atr_multiplier` | 1.5 | Multiplier ATR untuk radius zona Supply/Demand |
| `atr_sl_multiplier` | 0.5 | Multiplier ATR untuk buffer Stop Loss |
| `rr_ratio` | 3 | Risk:Reward ratio untuk Take Profit |
| `stop_loss` | - | Override SL dalam persen (opsional) |
| `take_profit` | - | Override TP dalam persen (opsional) |

---

## Timeframe yang Direkomendasikan

| Timeframe | Keterangan |
|-----------|------------|
| **15m** | Lebih banyak sinyal, noise lebih tinggi |
| **30m** | Keseimbangan antara frekuensi dan kualitas sinyal |
| **1h** | Sinyal lebih sedikit tapi lebih reliable |

---

## Contoh Konfigurasi Bot (var/conf.json)

```json
{
  "profiles": [
    {
      "name": "SMC Strategy",
      "bots": [
        {
          "exchange": "binance",
          "symbol": "BTC/USDT",
          "period": "1h",
          "strategy": "smc_rsi_divergence",
          "options": {
            "ema_fast_length": 50,
            "ema_slow_length": 200,
            "rsi_length": 14,
            "rsi_ma_length": 14,
            "atr_length": 14,
            "pivot_left": 5,
            "pivot_right": 3,
            "divergence_lookback": 8,
            "zone_atr_multiplier": 1.5,
            "atr_sl_multiplier": 0.5,
            "rr_ratio": 3
          }
        }
      ]
    }
  ]
}
```

---

## Cara Kerja Teknis

### 1. Deteksi Zona Supply/Demand

Zona diidentifikasi menggunakan `pivot_points_high_low`:
- **Demand Zone**: Area di sekitar Swing Low (pivot low)
- **Supply Zone**: Area di sekitar Swing High (pivot high)
- Harga dianggap "dalam zona" jika berada dalam radius `ATR × zone_atr_multiplier` dari level pivot

### 2. Deteksi RSI Divergence

Membandingkan pergerakan harga vs RSI dalam window `divergence_lookback` candle:
- **Bullish**: `price_current < price_prev` (Lower Low) AND `rsi_current > rsi_prev` (Higher Low)
- **Bearish**: `price_current > price_prev` (Higher High) AND `rsi_current < rsi_prev` (Lower High)
- Kekuatan divergence dihitung sebagai rata-rata dari persentase perbedaan harga dan RSI

### 3. Deteksi Engulfing Pattern

- **Bullish Engulfing**: Candle sebelumnya bearish, candle saat ini bullish, dan body candle saat ini menelan body candle sebelumnya
- **Bearish Engulfing**: Candle sebelumnya bullish, candle saat ini bearish, dan body candle saat ini menelan body candle sebelumnya

### 4. RSI Based MA Filter

- Menghitung SMA dari nilai RSI (bukan dari harga)
- Konfirmasi momentum: RSI > RSI-MA untuk buy, RSI < RSI-MA untuk sell

---

## Keterbatasan

1. **Single Timeframe**: Framework ini tidak mendukung multi-timeframe native. EMA 50/200 digunakan sebagai proxy tren H1, bukan data H1 yang sebenarnya.
2. **Zona Sederhana**: Deteksi zona menggunakan pivot points standar, bukan analisis Order Block yang kompleks seperti pada SMC manual.
3. **Divergence Sederhana**: Deteksi divergence membandingkan candle saat ini dengan candle-candle sebelumnya, bukan swing high/low yang teridentifikasi secara formal.

---

## Referensi

- Smart Money Concepts (SMC) - Institutional Trading
- RSI Divergence Trading Strategy
- Engulfing Candlestick Pattern
