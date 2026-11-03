import { getRuntimeConfig } from './runtime-config.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const shouldLog = (level: LogLevel): boolean => levels[level] <= (levels[getRuntimeConfig().logLevel as LogLevel] ?? levels.info);

const formatMessage = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  const timestamp = new Date().toISOString();
  if (getRuntimeConfig().logFormat === 'json') {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...(meta ? { meta } : {}),
    });
  }
  const metaString = meta ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}`;
};

const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  if (!shouldLog(level)) return;
  const output = formatMessage(level, message, meta);
  // Always log to stderr to avoid polluting stdio MCP responses.
  console.error(output);
};

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
