import { AiAnalysisInput, AiAnalysisResult } from './types';
import { AiService } from './ai_service';
import type { Logger } from '../modules/services';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider implements AiService {
  private enabled: boolean;

  constructor(
    private apiKey: string,
    private model: string,
    private logger: Logger,
    private minConfidence: number = 0.7
  ) {
    this.enabled = !!apiKey && apiKey.length > 0;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async analyze(input: AiAnalysisInput): Promise<AiAnalysisResult> {
    if (!this.enabled) {
      return {
        confirmed: true,
        confidence: 1.0,
        action: 'confirm',
        reasoning: 'AI disabled - auto-confirming',
        riskLevel: 'medium'
      };
    }

    if (!input.signal) {
      return {
        confirmed: false,
        confidence: 1.0,
        action: 'wait',
        reasoning: 'No signal to analyze',
        riskLevel: 'low'
      };
    }

    const prompt = this.buildPrompt(input);

    try {
      const response = await this.callGemini(prompt);
      return this.parseResponse(response, input);
    } catch (error: any) {
      this.logger.error(`[GeminiProvider] Analysis failed: ${error.message}`);
      return {
        confirmed: true,
        confidence: 0.5,
        action: 'confirm',
        reasoning: `AI analysis failed, defaulting to confirm: ${error.message}`,
        riskLevel: 'high'
      };
    }
  }

  private buildPrompt(input: AiAnalysisInput): string {
    const indicatorStr = Object.entries(input.indicators)
      .map(([key, value]) => `- ${key}: ${typeof value === 'number' ? value.toFixed(4) : value}`)
      .join('\n');

    const signalAction = input.signal === 'long' ? 'BUY/LONG' : input.signal === 'short' ? 'SELL/SHORT' : 'CLOSE POSITION';

    return `You are a cryptocurrency trading assistant. Analyze this trading signal and provide your assessment.

TRADING CONTEXT:
- Exchange: ${input.exchange}
- Pair: ${input.pair}
- Current Price: $${input.price.toFixed(2)}
- Timeframe: ${input.timeframe}
- Last Signal: ${input.lastSignal || 'none'}
- Proposed Signal: ${signalAction}

INDICATORS:
${indicatorStr}

Analyze this signal considering:
1. Trend direction and strength (ADX, EMA alignment)
2. Momentum (MACD histogram, RSI level)
3. Volume confirmation (OBV trend)
4. Risk/reward ratio for this entry point
5. Current market conditions

Respond in JSON format only:
{
  "confirmed": true/false,
  "confidence": 0.0-1.0,
  "action": "confirm" | "reject" | "wait",
  "reasoning": "Brief explanation (max 100 words)",
  "riskLevel": "low" | "medium" | "high",
  "suggestedStopLoss": price_in_usd_or_null,
  "suggestedTakeProfit": price_in_usd_or_null
}

Be conservative. Only confirm if confidence > 70%. Default to "wait" if uncertain.`;
  }

  private async callGemini(prompt: string): Promise<any> {
    const url = `${GEMINI_API_URL}/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
          topP: 0.8
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data;
  }

  private parseResponse(response: any, input: AiAnalysisInput): AiAnalysisResult {
    try {
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const confidence = Math.max(0, Math.min(1, parsed.confidence || 0.5));
      const action = parsed.action || 'wait';
      const confirmed = action === 'confirm' && confidence >= this.minConfidence;

      return {
        confirmed,
        confidence,
        action,
        reasoning: parsed.reasoning || 'No reasoning provided',
        riskLevel: parsed.riskLevel || 'medium',
        suggestedStopLoss: parsed.suggestedStopLoss || undefined,
        suggestedTakeProfit: parsed.suggestedTakeProfit || undefined
      };
    } catch (error: any) {
      this.logger.error(`[GeminiProvider] Failed to parse response: ${error.message}`);
      return {
        confirmed: false,
        confidence: 0.5,
        action: 'wait',
        reasoning: 'Failed to parse AI response',
        riskLevel: 'high'
      };
    }
  }
}
