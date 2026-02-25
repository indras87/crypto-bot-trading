import { AiAnalysisInput, AiAnalysisResult } from './types';

export interface AiService {
  analyze(input: AiAnalysisInput): Promise<AiAnalysisResult>;
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
}
