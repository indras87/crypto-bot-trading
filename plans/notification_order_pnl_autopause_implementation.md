# Implementation Plan: Order/PnL/Auto-Pause Notifications

## Summary

Add additional runtime notifications for:

1. `ORDER_OK` (successful order execution)
2. `ORDER_FAIL` (failed exchange order execution)
3. `PNL` (realized PnL on close)
4. `AUTO_PAUSE` (bot auto-paused by adaptive risk policy)

Existing signal notification (`[long/short/close ...]`) remains unchanged and must still be sent.

Notifications are sent through existing `Notify` pipeline (all active notifiers: Telegram/Slack/Mail).

## Scope Decisions (Locked)

- Channel scope: all active notifiers via `Notify`
- Trading modes: both `live` and `paper`
- Fail events: only exchange-order execution errors (`placeOrder`, `closePosition`)
- Message style: detailed payload
- Backward compatibility: existing signal notification remains

## Implementation Changes

### 1) BotRunner notification helpers

In `src/strategy/bot_runner.ts`, add private helper(s) for consistent message formatting:

- `notifyOrderOk(...)`
- `notifyOrderFail(...)`
- `notifyPnl(...)`
- `notifyAutoPause(...)`

Each message should include:

- Event type: `ORDER_OK` | `ORDER_FAIL` | `PNL` | `AUTO_PAUSE`
- Profile + bot identity
- Exchange + symbol
- Strategy + execution mode (`live`/`paper`)
- Signal/side (`long`/`short`/`close`)
- Price, amount/contracts, order id (if available)
- Reason/error text for failures

Use safe fallbacks (`n/a`) when value is unavailable.

### 2) Order success notifications

Emit `ORDER_OK` after successful:

- `placeOrder` in `long`/`short` branch (live)
- `closePosition` or spot close `placeOrder` in `close` branch (live)
- paper order open/close path in `executePaperSignal`

Do not remove or alter existing signal notification.

### 3) Order failure notifications

Wrap exchange order execution paths with `try/catch`:

- `profileService.placeOrder(...)`
- `profileService.closePosition(...)`

On catch:

- Send `ORDER_FAIL` notification with context + error message
- Re-throw the error to preserve current logging/error behavior

Do **not** send `ORDER_FAIL` for non-order runtime errors outside order calls.

### 4) PnL notifications

When closing a position and `realizedPnl` is computed, emit `PNL` notification:

- live futures close path
- live spot close path
- paper close path

Fields:

- realized PnL absolute value
- realized PnL percentage
- entry/exit price
- contracts/amount where available

PnL percent default rule:

- If entry notional is available and > 0: `pnlPct = (realizedPnl / entryNotional) * 100`
- Else fallback to `n/a`

### 5) Auto-pause notifications

In `handleAutoPause(profile, bot, risk)`:

- If `risk.paused === true` and `bot.status === 'running'`:
  - Send `AUTO_PAUSE` notification with `pause_reason`
  - Keep current behavior: log warning and update bot status to `stopped`

## Message Templates (Reference)

```text
[ORDER_OK] profile=<profileName> bot=<botName> mode=<live|paper> strategy=<strategy> pair=<exchange>:<symbol> signal=<long|short|close> price=<price|n/a> amount=<amount|n/a> contracts=<contracts|n/a> orderId=<id|n/a>
```

```text
[ORDER_FAIL] profile=<profileName> bot=<botName> mode=<live|paper> strategy=<strategy> pair=<exchange>:<symbol> signal=<long|short|close> error="<message>"
```

```text
[PNL] profile=<profileName> bot=<botName> mode=<live|paper> pair=<exchange>:<symbol> side=<long|short> entry=<entryPrice|n/a> exit=<exitPrice|n/a> pnl=<value> pnlPct=<value|n/a>
```

```text
[AUTO_PAUSE] profile=<profileName> bot=<botName> pair=<exchange>:<symbol> reason=<pause_reason|unknown>
```

## Test Plan

Add a dedicated `BotRunner` test file (new) with mocked dependencies.

Required scenarios:

1. Sends `ORDER_OK` for successful live `long/short`
2. Sends `ORDER_FAIL` when live `placeOrder` throws
3. Sends `ORDER_OK` + `PNL` for successful live futures `close`
4. Sends `ORDER_OK` + `PNL` for successful live spot `close`
5. Sends `ORDER_OK` + `PNL` for successful paper `close`
6. Sends `AUTO_PAUSE` and stops bot when risk pauses bot
7. Existing signal notification is still sent (no regression)

Verification commands:

- `npm test`
- `npm run build:tsc`

## Non-Goals

- No HTTP/API schema changes
- No database schema changes
- No notifier-specific custom routing (uses shared `Notify`)

