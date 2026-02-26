/**
 * Build TradingView symbol from exchange and pair
 * Converts bot's internal format (e.g., "bybit:BTC/USDT:USDT") to TradingView format (e.g., "BYBIT:BTCUSDT.P")
 */
export function buildTradingViewSymbol(exchange: string, pair: string): string {
  let symbol = pair.replace('/', '');

  // Exchange-specific adjustments
  if (exchange === 'binance' || exchange === 'binanceusdm' || exchange === 'binancecoinm') {
    // For Binance Futures, TradingView usually uses .P or PERP
    if (pair.includes(':USDT')) {
      symbol = symbol.replace(':USDT', '.P');
    } else if (pair.includes(':USDC')) {
      symbol = symbol.replace(':USDC', '.P');
    } else if (pair.includes(':BTC')) {
      symbol = symbol.replace(':BTC', '.P');
    }
  }

  if (exchange === 'bybit') {
    if (pair.includes(':USDT')) {
      symbol = symbol.replace(':USDT', '.P');
    } else if (pair.includes(':USDC')) {
      symbol = symbol.replace(':USDC', '.P');
    }
  }

  // Map exchange names to TradingView format
  const exchangeMap: Record<string, string> = {
    'coinbasepro': 'coinbase',
    'coinbase': 'coinbase',
    'binance': 'binance',
    'binanceusdm': 'binance',
    'binancecoinm': 'binance',
    'bybit': 'bybit',
    'kraken': 'kraken',
    'bitfinex': 'bitfinex',
  };

  const tvExchange = exchangeMap[exchange.toLowerCase()] || exchange.toLowerCase();

  return `${tvExchange.toUpperCase()}:${symbol.toUpperCase()}`;
}

/**
 * Parse exchange:symbol format from URL parameter
 * e.g., "bybit:BTC/USDT:USDT" -> { exchange: "bybit", pair: "BTC/USDT:USDT" }
 */
export function parseExchangeSymbol(param: string): { exchange: string; pair: string } | null {
  // Find the first colon which separates exchange from pair
  const colonIndex = param.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const exchange = param.substring(0, colonIndex);
  const pair = decodeURIComponent(param.substring(colonIndex + 1));

  return { exchange, pair };
}
