import { config } from './config.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const levels: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLevel = ((): LogLevel => {
  const level = config.logLevel as LogLevel;
  return level in levels ? level : 'info';
})();

const shouldLog = (level: LogLevel): boolean => {
  return levels[level] <= levels[currentLevel];
};

const formatMessage = (level: LogLevel, message: string, meta?: Record<string, unknown>): string => {
  const timestamp = new Date().toISOString();
  if (config.logFormat === 'json') {
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
