export type SignalType = 'long' | 'short' | 'close' | undefined;

export interface AiAnalysisInput {
  pair: string;
  exchange: string;
  signal: SignalType;
  price: number;
  indicators: Record<string, any>;
  lastSignal: SignalType;
  timeframe: string;
}

export interface AiAnalysisResult {
  confirmed: boolean;
  confidence: number;
  action: 'confirm' | 'reject' | 'wait';
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  suggestedStopLoss?: number;
  suggestedTakeProfit?: number;
}

export interface AiProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiServiceConfig {
  enabled: boolean;
  provider: string;
  gemini?: {
    api_key: string;
    model: string;
  };
  options?: {
    confirm_signals?: boolean;
    analyze_sentiment?: boolean;
    risk_assessment?: boolean;
    min_confidence?: number;
  };
}
