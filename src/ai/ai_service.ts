import { AiAnalysisInput, AiAnalysisResult } from './types';

export interface AiService {
  analyze(input: AiAnalysisInput): Promise<AiAnalysisResult>;
  analyzeBacktest(result: any): Promise<string>;
  isEnabled(): boolean;
}

export class NoopAiService implements AiService {
  isEnabled(): boolean {
    return false;
  }

  async analyze(input: AiAnalysisInput): Promise<AiAnalysisResult> {
    return {
      confirmed: true,
      confidence: 1.0,
      action: 'confirm',
      reasoning: 'AI service not configured - auto-confirming',
      riskLevel: 'medium'
    };
  }

  async analyzeBacktest(result: any): Promise<string> {
    return 'AI service not configured. Please enable Gemini in var/conf.json to get strategy optimization recommendations.';
  }
}
