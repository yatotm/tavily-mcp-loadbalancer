export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
}

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  exponentialBase: 2,
  jitter: true,
};

export const computeDelay = (attempt: number, config: RetryConfig): number => {
  const exponential = config.baseDelay * Math.pow(config.exponentialBase, attempt);
  const capped = Math.min(exponential, config.maxDelay);
  if (!config.jitter) return capped;
  const jitter = Math.random() * 0.4 + 0.8; // 0.8 - 1.2
  return Math.floor(capped * jitter);
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
