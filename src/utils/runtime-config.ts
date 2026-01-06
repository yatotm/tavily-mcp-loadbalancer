import { config } from './config.js';

export type RuntimeConfig = typeof config;

const runtimeConfig: RuntimeConfig = { ...config };

export const getRuntimeConfig = (): RuntimeConfig => runtimeConfig;

export const updateRuntimeConfig = (updates: Partial<RuntimeConfig>): void => {
  Object.assign(runtimeConfig, updates);
};
