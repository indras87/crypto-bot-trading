import type { DashboardConfig, DashboardPair } from './config_service';

function isBinancePerpetualOrFuturesSymbol(symbol: string): boolean {
  return symbol.includes(':');
}

function resolveBinanceDerivativesExchange(symbol: string): string {
  const settlement = symbol.split(':')[1] || '';
  if (settlement.startsWith('USDT') || settlement.startsWith('USDC')) {
    return 'binanceusdm';
  }
  return 'binancecoinm';
}

export function normalizeDashboardPair(pair: DashboardPair): DashboardPair {
  const exchange = pair.exchange.trim().toLowerCase();
  const symbol = pair.symbol.trim();

  if (exchange !== 'binance' || !isBinancePerpetualOrFuturesSymbol(symbol)) {
    return { exchange, symbol };
  }

  return {
    exchange: resolveBinanceDerivativesExchange(symbol),
    symbol
  };
}

export function normalizeDashboardConfig(config: DashboardConfig): DashboardConfig {
  return {
    periods: [...config.periods],
    pairs: config.pairs.map(normalizeDashboardPair)
  };
}
