import type { ConfigService } from '../modules/system/config_service';
import type { AiService } from './ai_service';

/**
 * AI Status Types
 * Comprehensive status tracking for AI validation system
 */
export type AiStatus = 'NOT_CONFIGURED' | 'DISABLED' | 'ACTIVE' | 'ERROR';

export interface AiStatusDetail {
  status: AiStatus;
  provider: string | null;
  isEnabled: boolean;
  isConfigured: boolean;
  lastValidationTime?: Date;
  totalSignalsValidated: number;
  totalSignalsAccepted: number;
  totalSignalsRejected: number;
  lastError?: string;
  errorCount: number;
}

export interface AiStatusDisplay {
  status: AiStatus;
  label: string;
  cssClass: string;
  icon: string;
  description: string;
}

/**
 * AI Status Service
 * Tracks real-time status of AI validation service
 */
export class AiStatusService {
  private stats = {
    totalSignalsValidated: 0,
    totalSignalsAccepted: 0,
    totalSignalsRejected: 0,
    errorCount: 0,
    lastError: undefined as string | undefined,
    lastValidationTime: undefined as Date | undefined
  };

  constructor(
    private configService: ConfigService,
    private aiService?: AiService
  ) { }

  /**
   * Get detailed status of AI service
   */
  getStatusDetail(): AiStatusDetail {
    const aiConfig = this.configService.getConfig('ai', null);

    const isConfigured = this.checkIsConfigured(aiConfig);
    const isEnabled = aiConfig?.enabled === true;
    const provider = aiConfig?.provider || null;

    let status: AiStatus;

    if (!isConfigured) {
      status = 'NOT_CONFIGURED';
    } else if (!isEnabled) {
      status = 'DISABLED';
    } else if (this.stats.errorCount > 0 && this.stats.lastError) {
      status = 'ERROR';
    } else if (this.aiService?.isEnabled()) {
      status = 'ACTIVE';
    } else {
      status = 'DISABLED';
    }

    return {
      status,
      provider,
      isEnabled,
      isConfigured,
      lastValidationTime: this.stats.lastValidationTime,
      totalSignalsValidated: this.stats.totalSignalsValidated,
      totalSignalsAccepted: this.stats.totalSignalsAccepted,
      totalSignalsRejected: this.stats.totalSignalsRejected,
      lastError: this.stats.lastError,
      errorCount: this.stats.errorCount
    };
  }

  /**
   * Get display-friendly status info with styling
   */
  getStatusDisplay(): AiStatusDisplay {
    const detail = this.getStatusDetail();

    const displays: Record<AiStatus, AiStatusDisplay> = {
      NOT_CONFIGURED: {
        status: 'NOT_CONFIGURED',
        label: 'AI Not Configured',
        cssClass: 'bg-gray-100 text-gray-500 border border-gray-300',
        icon: 'fa-robot',
        description: 'AI service is not configured. Add ai config to var/conf.json to enable.'
      },
      DISABLED: {
        status: 'DISABLED',
        label: 'AI Disabled',
        cssClass: 'bg-yellow-50 text-yellow-600 border border-yellow-300',
        icon: 'fa-robot-slash',
        description: 'AI is configured but disabled. Set ai.enabled to true to activate.'
      },
      ACTIVE: {
        status: 'ACTIVE',
        label: 'AI Active',
        cssClass: 'bg-green-50 text-green-600 border border-green-300',
        icon: 'fa-brain',
        description: 'AI validation is active and processing signals.'
      },
      ERROR: {
        status: 'ERROR',
        label: 'AI Error',
        cssClass: 'bg-red-50 text-red-600 border border-red-300',
        icon: 'fa-triangle-exclamation',
        description: `AI validation encountered errors. Last: ${detail.lastError || 'Unknown error'}`
      }
    };

    return displays[detail.status];
  }

  /**
   * Record a signal validation attempt
   */
  recordValidation(confirmed: boolean, error?: string): void {
    this.stats.totalSignalsValidated++;
    this.stats.lastValidationTime = new Date();

    if (error) {
      this.stats.errorCount++;
      this.stats.lastError = error;
    } else {
      if (confirmed) {
        this.stats.totalSignalsAccepted++;
      } else {
        this.stats.totalSignalsRejected++;
      }
    }
  }

  /**
   * Record an error
   */
  recordError(error: string): void {
    this.stats.errorCount++;
    this.stats.lastError = error;
  }

  /**
   * Clear error state
   */
  clearError(): void {
    this.stats.errorCount = 0;
    this.stats.lastError = undefined;
  }

  /**
   * Reset all statistics
   */
  resetStats(): void {
    this.stats = {
      totalSignalsValidated: 0,
      totalSignalsAccepted: 0,
      totalSignalsRejected: 0,
      errorCount: 0,
      lastError: undefined,
      lastValidationTime: undefined
    };
  }

  /**
   * Get formatted status summary for logging
   */
  getStatusSummary(): string {
    const detail = this.getStatusDetail();
    const display = this.getStatusDisplay();

    let summary = `[AI Status] ${display.label} | Provider: ${detail.provider || 'none'} | `;
    summary += `Validated: ${detail.totalSignalsValidated} | `;
    summary += `Accepted: ${detail.totalSignalsAccepted} | `;
    summary += `Rejected: ${detail.totalSignalsRejected}`;

    if (detail.errorCount > 0) {
      summary += ` | Errors: ${detail.errorCount}`;
    }

    return summary;
  }

  /**
   * Check if AI is properly configured
   */
  private checkIsConfigured(aiConfig: any): boolean {
    if (!aiConfig) return false;
    if (!aiConfig.provider) return false;

    if (aiConfig.provider === 'gemini') {
      return !!(aiConfig.gemini?.api_key);
    }

    return false;
  }
}
