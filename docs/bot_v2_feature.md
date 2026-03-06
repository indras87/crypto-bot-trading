# Bot V2 Feature Documentation

## Overview
`Bot V2` adalah jalur bot baru untuk:
- AI signal validation
- Adaptive self-improvement
- Auto entry long/short futures
- Risk guardrail (drawdown cap + live gate)

`Bot V2` **terpisah** dari bot lama:
- Bot lama tetap di `profile.bots`
- Bot V2 di `profile.botsV2`
- Runner lama (`BotRunner`) tetap berjalan
- Runner baru (`BotRunnerV2`) khusus `botsV2`

Tujuannya: menambah kemampuan AI tanpa mengubah behavior bot lama.

## Isolation Model
### Config shape
```json
{
  "profiles": [
    {
      "id": "profile-id",
      "bots": [],
      "botsV2": []
    }
  ]
}
```

### Bot V2 fields
- `id`, `name`, `strategy`, `pair`, `interval`, `capital`, `status`
- `useAiValidator`
- `executionMode`: `paper` | `live`
- `adaptiveEnabled`
- `adaptiveUpdateEveryTrades`
- `maxDrawdownPct`
- `futuresOnlyLongShort`
- `aiMinConfidence`
- `options`

## UI & Routes
## Profile page
Di halaman `/profiles/:id` ada tab baru: `Bot V2`.

### Bot V2 routes
- `GET /profiles/:id/bots-v2/new`
- `GET /profiles/:id/bots-v2/:botId/edit`
- `POST /profiles/:id/bots-v2`
- `POST /profiles/:id/bots-v2/:botId`
- `POST /profiles/:id/bots-v2/:botId/delete`

### Policy status API
- `GET /api/ai/policy-status-v2?profileId=<id>&botId=<id>`

Response berisi:
- drawdown status
- paused state
- policy version
- dynamic AI min confidence
- live gate eligibility

## Runtime Flow
1. `Trade.start()` menjalankan:
- `BotRunner` (legacy)
- `BotRunnerV2` (baru)

2. `BotRunnerV2` memproses hanya `profile.botsV2`.

3. Untuk setiap sinyal:
- Generate signal dari strategy executor
- Optional AI validator (`useAiValidator`)
- Futures guard (`futuresOnlyLongShort`)
- Simpan signal ke repository
- Eksekusi order berdasarkan `executionMode`:
  - `paper`: simulasi position
  - `live`: order real via profile exchange

4. Saat close trade:
- Record PnL ke `position_history`
- Update risk state
- Trigger adaptive policy update (setiap N closed trades)
- Auto pause jika melebihi drawdown cap

5. Live gate:
- V2 mode `live` diblok jika syarat minimum belum terpenuhi (mis. jumlah trade/metrics).

## Adaptive Policy & Persistence
Data AI/policy disimpan di SQLite:
- `ai_signal_decisions`
- `bot_risk_state`
- `policy_snapshots`
- `policy_updates`

Service utama:
- `AdaptivePolicyService`
- `AiPolicyRepository`

Fungsi utama:
- Bootstrap policy awal
- Dynamic minimum confidence
- Risk tracking (equity peak, DD, pause reason)
- Policy update terkontrol berbasis hasil trade

## How To Use
1. Buka profile: `/profiles/:id`
2. Masuk tab `Bot V2`
3. Klik `Add Bot V2`
4. Isi konfigurasi:
- Pair futures (contoh mengandung `:`) jika futures guard aktif
- `executionMode=paper` untuk fase awal
- `adaptiveEnabled=true`
- `adaptiveUpdateEveryTrades=20` (default)
- `maxDrawdownPct=12` (default)
- `aiMinConfidence=0.7` (default)
5. Set `status=running`

Untuk monitoring:
- panggil `/api/ai/policy-status-v2`

## Backward Compatibility
Fitur lama tidak berubah:
- Route bot lama (`/profiles/:id/bots/*`) tetap sama
- Form bot lama tetap sama
- Runner bot lama tetap membaca `profile.bots` saja
- Existing profile tanpa `botsV2` tetap valid

## Troubleshooting
### Bot V2 tidak eksekusi order live
Periksa:
- `executionMode` harus `live`
- `status` harus `running`
- live gate status via API policy
- kredensial exchange pada profile

### Sinyal long/short tidak jalan
Periksa:
- pair futures jika `futuresOnlyLongShort=true`
- AI validator mungkin reject sinyal
- confidence bisa di bawah threshold policy

### Bot auto-pause
Periksa:
- `maxDrawdownPct`
- endpoint policy status untuk `pauseReason`

## Suggested Rollout
1. Mulai `paper` mode
2. Kumpulkan closed trades dan evaluasi KPI
3. Pastikan live gate memenuhi syarat
4. Pindah ke `live` secara bertahap
