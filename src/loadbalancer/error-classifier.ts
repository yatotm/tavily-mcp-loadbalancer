import axios from 'axios';

export type ErrorType = 'network' | 'rate_limit' | 'quota_exceeded' | 'auth' | 'client' | 'server' | 'unknown';

export interface ErrorClassification {
  type: ErrorType;
  shouldRetry: boolean;
  shouldDisableKey: boolean;
  retryDelay?: number;
  message: string;
  incrementErrorCount: boolean;
}

const networkCodes = new Set([
  'ECONNABORTED',
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
]);

const extractMessage = (data: unknown): string => {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'object') {
    const message = (data as any).message || (data as any).error || (data as any).detail;
    if (message) return String(message);
    return JSON.stringify(data);
  }
  return String(data);
};

const extractDetailMessage = (detail: unknown): string => {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object') {
    const message = (detail as any).error || (detail as any).message || (detail as any).detail;
    return message ? String(message) : '';
  }
  return String(detail);
};

const isQuotaMessage = (message: string): boolean => {
  const text = message.toLowerCase();
  return text.includes('quota') || text.includes('exceed') || text.includes('credit') || text.includes('usage limit');
};

const isRateLimitMessage = (message: string): boolean => {
  const text = message.toLowerCase();
  return text.includes('rate limit') || text.includes('too many requests');
};

export const classifyError = (
  error: unknown,
  responseData?: unknown,
  responseStatus?: number,
  retryAfterHeader?: string | number
): ErrorClassification => {
  if (axios.isAxiosError(error)) {
    const code = error.code || '';
    if (networkCodes.has(code)) {
      return {
        type: 'network',
        shouldRetry: true,
        shouldDisableKey: false,
        message: 'Network error, will retry',
        incrementErrorCount: false,
      };
    }

    const status = responseStatus ?? error.response?.status;
    const message = extractMessage(responseData ?? error.response?.data ?? error.message);

    if (status && status >= 500) {
      return {
        type: 'server',
        shouldRetry: true,
        shouldDisableKey: false,
        message: message || 'Server error, will retry',
        incrementErrorCount: false,
      };
    }

    if (status === 401 || status === 403 || status === 432 || status === 433) {
      return {
        type: 'auth',
        shouldRetry: false,
        shouldDisableKey: true,
        message: message || 'Invalid or disabled API key',
        incrementErrorCount: true,
      };
    }

    if (status === 429) {
      if (isQuotaMessage(message)) {
        return {
          type: 'quota_exceeded',
          shouldRetry: false,
          shouldDisableKey: true,
          message: message || 'API quota exceeded',
          incrementErrorCount: true,
        };
      }
      const retrySeconds = typeof retryAfterHeader === 'string'
        ? Number.parseInt(retryAfterHeader, 10)
        : typeof retryAfterHeader === 'number'
          ? retryAfterHeader
          : 1;
      return {
        type: 'rate_limit',
        shouldRetry: true,
        shouldDisableKey: false,
        retryDelay: Number.isFinite(retrySeconds) ? retrySeconds * 1000 : 1000,
        message: message || 'Rate limited, will retry',
        incrementErrorCount: false,
      };
    }

    if (status && status >= 400) {
      return {
        type: 'client',
        shouldRetry: false,
        shouldDisableKey: false,
        message: message || 'Client error',
        incrementErrorCount: false,
      };
    }

    if (message && (isQuotaMessage(message) || isRateLimitMessage(message))) {
      return {
        type: isQuotaMessage(message) ? 'quota_exceeded' : 'rate_limit',
        shouldRetry: !isQuotaMessage(message),
        shouldDisableKey: isQuotaMessage(message),
        message: message,
        incrementErrorCount: isQuotaMessage(message),
      };
    }
  }

  const message = extractMessage(responseData ?? error);
  if (message && isQuotaMessage(message)) {
    return {
      type: 'quota_exceeded',
      shouldRetry: false,
      shouldDisableKey: true,
      message,
      incrementErrorCount: true,
    };
  }

  return {
    type: 'unknown',
    shouldRetry: false,
    shouldDisableKey: false,
    message: message || 'Unknown error',
    incrementErrorCount: false,
  };
};

export const classifyResponsePayload = (payload: unknown): ErrorClassification | null => {
  if (!payload || typeof payload !== 'object') return null;
  if (!('detail' in payload)) return null;
  const detail = (payload as { detail?: unknown }).detail;
  const message = extractDetailMessage(detail);
  if (!message) return null;
  if (isQuotaMessage(message)) {
    return {
      type: 'quota_exceeded',
      shouldRetry: false,
      shouldDisableKey: true,
      message,
      incrementErrorCount: true,
    };
  }
  if (isRateLimitMessage(message)) {
    return {
      type: 'rate_limit',
      shouldRetry: true,
      shouldDisableKey: false,
      message,
      incrementErrorCount: false,
    };
  }
  if (message.toLowerCase().includes('invalid api key') || message.toLowerCase().includes('unauthorized')) {
    return {
      type: 'auth',
      shouldRetry: false,
      shouldDisableKey: true,
      message,
      incrementErrorCount: true,
    };
  }
  return null;
};
