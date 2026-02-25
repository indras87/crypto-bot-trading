# Gemini CLI Context: Crypto Trading Bot

This project is a comprehensive cryptocurrency trading bot built with Node.js and TypeScript. It leverages CCXT for exchange integration, SQLite for persistence, and includes a web-based dashboard for management.

## Project Overview

- **Core Technology:** Node.js, TypeScript, SQLite.
- **Exchange Integration:** [CCXT](https://github.com/ccxt/ccxt) (supports 100+ exchanges).
- **Technical Analysis:** TA-Lib and `technicalindicators` library.
- **Web UI:** Express.js with EJS templates and Tailwind CSS.
- **Architecture:** 
  - Centralized dependency injection in `src/modules/services.ts`.
  - Strategy-based bot execution managed by `BotRunner`.
  - Controller-Service-Repository pattern for web and data layers.
  - Multi-notification support (Slack, Telegram, Mail).

## Building and Running

### Prerequisites
- Node.js >= 22.0
- `build-essential` (for sqlite3 and talib compilation)

### Commands
- **Install Dependencies:** `npm install`
- **Build Project:** `npm run build` (uses esbuild)
- **Start Bot (Production):** `npm start` (builds and runs `trade` command)
- **Start Bot (Development):** `npm run start:dev` (uses ts-node)
- **Run Tests:** `npm test` (uses Mocha)
- **Linting:** `npm run lint` (inferred from package.json)

## Key Directories

- `src/command/`: CLI command implementations (e.g., `trade`).
- `src/controller/`: Express controllers for the web UI.
- `src/modules/`: Core business logic, including `services.ts` (DI) and `trade.ts`.
- `src/strategy/`: Strategy execution engine and built-in strategies.
  - `src/strategy/strategies/`: Location for strategy implementations (e.g., `macd.ts`).
- `src/repository/`: SQLite data access layers.
- `src/system/`: Low-level system services (config, candle importers, etc.).
- `var/`: **Crucial directory** containing `conf.json` (user config), `bot.db` (SQLite database), and logs.
- `views/`: EJS templates for the web dashboard.

## Development Conventions

### Strategies
- All strategies should extend `StrategyBase` from `src/strategy/strategy.ts`.
- Strategies define indicators in `defineIndicators()` and implement logic in `execute()`.
- Register new strategies in `src/modules/services.ts` within `getV2StrategyRegistry()`.

### Data Access
- Use repositories in `src/repository/` for database interactions.
- Schema is defined in `src/utils/database_schema.ts`.

### Services & DI
- Access system components through the `services` singleton in `src/modules/services.ts`.
- Avoid direct instantiation of services where possible; use the getter methods in `services`.

### Testing
- Place tests in the `test/` directory.
- Use `mocha` and `ts-node/register`.

## Configuration
- The main configuration file is `var/conf.json`. 
- Passwords and API keys should be managed there (not committed).
- Bot profiles and pairs are managed through the UI or `var/` files depending on specific implementations.
