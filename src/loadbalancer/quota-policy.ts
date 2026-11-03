import type { Provider } from '../data/database.js';
import type { ExaBillingConfig } from '../data/exa-billing-store.js';
export function nextReset(provider: Provider, reason: string | undefined, settings?: ExaBillingConfig, now = new Date()): string | null {
  if (provider === 'exa' && settings?.resetMode === 'manual') return null;
  if (provider === 'exa' && settings?.resetMode !== 'monthly' && reason !== 'NO_MORE_CREDITS') return null;
  const day = provider === 'exa' && settings?.resetMode === 'monthly' ? settings.resetDay : 1;
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (candidate.getTime() <= now.getTime()) candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  return candidate.toISOString();
}
