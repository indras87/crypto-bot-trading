import { AiAnalysisInput, AiAnalysisResult } from './types';
import { AiService } from './ai_service';
import type { Logger } from '../modules/services';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

export class GeminiProvider implements AiService {
  private genAI: GoogleGenerativeAI;
  private modelInstance: GenerativeModel;
  private enabled: boolean;

  constructor(
    private apiKey: string,
    private model: string,
    private logger: Logger,
    private minConfidence: number = 0.7
  ) {
    console.log('[GeminiProvider Debug] Constructor called');
    console.log('[GeminiProvider Debug] API key present:', !!apiKey);
    console.log('[GeminiProvider Debug] API key length:', apiKey?.length || 0);
    console.log('[GeminiProvider Debug] Model:', model);

    this.enabled = !!apiKey && apiKey.length > 0;
    console.log('[GeminiProvider Debug] Enabled:', this.enabled);

    if (this.enabled) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      // Ensure we use a valid model name (fallback to 2.0-flash)
      const validModel = model && (model.includes('gemini-3-flash-preview') || model.includes('gemini-2.0')) ? model : 'gemini-2.5-flash';

      this.modelInstance = this.genAI.getGenerativeModel({
        model: validModel,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4096,
          topP: 0.1
        }
      });
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async analyze(input: AiAnalysisInput): Promise<AiAnalysisResult> {
    const defaultResult: AiAnalysisResult = {
      confirmed: true,
      confidence: 1.0,
      action: 'confirm',
      reasoning: 'AI disabled or error - defaulting to confirm',
      riskLevel: 'medium'
    };

    if (!this.enabled) return defaultResult;

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
      const result = await this.modelInstance.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      return this.parseResponse(text, input);
    } catch (error: any) {
      this.logger.error(`[GeminiProvider] Signal analysis failed: ${error.message}`);
      return {
        ...defaultResult,
        confidence: 0.5,
        reasoning: `AI analysis failed: ${error.message}`,
        riskLevel: 'high'
      };
    }
  }

  async analyzeBacktest(result: any): Promise<string> {
    if (!this.enabled) {
      return 'AI disabled. Please configure your API key.';
    }

    const prompt = `You are an expert crypto quantitative trader. Analyze these backtest results and provide optimization recommendations.

BACKTEST SUMMARY:
- Strategy: ${result.strategyName}
- Current Parameters: ${JSON.stringify(result.strategyOptions)}
- Pair: ${result.exchange}:${result.symbol}
- Period: ${result.period}
- Trades: ${result.summary.trades.total}
- Win Rate: ${result.summary.trades.profitabilityPercent.toFixed(1)}%
- Net Profit: ${result.summary.netProfit.toFixed(2)}%
- Max Drawdown: ${result.summary.maxDrawdown.toFixed(2)}%

Analyze and provide:
1. Performance Critique.
2. Parameter Optimization (suggest specific numbers).
3. Risk Management tips.

Markdown format only. Be concise and professional.`;

    try {
      // Use a fresh model instance for text-heavy content to avoid shared config issues
      const textModel = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const resultObj = await textModel.generateContent(prompt);
      const response = await resultObj.response;
      return response.text() || 'No recommendations generated.';
    } catch (error: any) {
      this.logger.error(`[GeminiProvider] Backtest analysis failed: ${error.message}`);
      return `Failed to generate recommendations: ${error.message}`;
    }
  }

  private buildPrompt(input: AiAnalysisInput): string {
    const indicatorStr = Object.entries(input.indicators)
      .map(([key, value]) => `- ${key}: ${typeof value === 'number' ? value.toFixed(4) : value}`)
      .join('\n');

    const signalAction = input.signal === 'long' ? 'BUY/LONG' : input.signal === 'short' ? 'SELL/SHORT' : 'CLOSE POSITION';

    if (input.backtestMode) {
      return `ACT AS A TRADING ROBOT. VALIDATE THIS SIGNAL.
OUTPUT ONLY RAW JSON. NO MARKDOWN. NO EXTRA TEXT.

CONTEXT:
- Pair: ${input.exchange}:${input.pair}
- Price: ${input.price.toFixed(2)}
- TF: ${input.timeframe}
- Action: ${signalAction}

INDICATORS:
${indicatorStr}

VALIDATION RULES (MUST ALL PASS):
1. PSAR: Verify histogram crossed (price crossed PSAR)
2. ADX: Must be > 25 for strong trend
3. EMA: Long trend must align with signal direction
4. RSI: Must be between 30-70 (not overbought/oversold)
5. Risk-Reward: Must have at least 2:1 potential

JSON SCHEMA:
{
  "confirmed": boolean,
  "confidence": number,
  "action": "confirm"|"reject"|"wait",
  "riskLevel": "low"|"medium"|"high"
}`;
    }

    return `ACT AS A TRADING ROBOT. VALIDATE THIS SIGNAL.
OUTPUT ONLY RAW JSON. NO MARKDOWN. NO EXTRA TEXT.

CONTEXT:
- Pair: ${input.exchange}:${input.pair}
- Price: ${input.price.toFixed(2)}
- TF: ${input.timeframe}
- Action: ${signalAction}

INDICATORS:
${indicatorStr}

VALIDATION RULES (MUST ALL PASS):
1. PSAR: Verify histogram crossed (price crossed PSAR)
2. ADX: Must be > 25 for strong trend
3. EMA: Long trend must align with signal direction
4. RSI: Must be between 30-70 (not overbought/oversold)
5. Risk-Reward: Must have at least 2:1 potential

JSON SCHEMA:
{
  "confirmed": boolean,
  "confidence": number,
  "action": "confirm"|"reject"|"wait",
  "reasoning": "string",
  "riskLevel": "low"|"medium"|"high",
  "suggestedStopLoss": number|null,
  "suggestedTakeProfit": number|null
}`;
  }

  private parseResponse(text: string, input: AiAnalysisInput): AiAnalysisResult {
    try {
      let start = text.indexOf('{');
      let end = text.lastIndexOf('}');

      if (start !== -1 && end === -1) {
        text = text + '\n}';
        end = text.lastIndexOf('}');
      }

      if (start === -1 || end === -1) {
        throw new Error('No JSON structure found in response');
      }

      const jsonStr = text.substring(start, end + 1);
      const parsed = JSON.parse(jsonStr);

      return {
        confirmed: !!parsed.confirmed,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        action: parsed.action || 'wait',
        reasoning: parsed.reasoning || 'No reasoning provided',
        riskLevel: parsed.riskLevel || 'medium',
        suggestedStopLoss: parsed.suggestedStopLoss || undefined,
        suggestedTakeProfit: parsed.suggestedTakeProfit || undefined
      };
    } catch (error: any) {
      this.logger.error(`[GeminiProvider] Parse error: ${error.message}. Snippet: ${text.substring(0, 50)}`);
      return {
        confirmed: false,
        confidence: 0.5,
        action: 'wait',
        reasoning: `Failed to parse AI response: ${error.message}`,
        riskLevel: 'high'
      };
    }
  }
}
