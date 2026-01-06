export const getCurrentQuotaPeriod = (): string => {
  const now = new Date();
  const utcYear = now.getUTCFullYear();
  const utcMonth = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${utcYear}-${utcMonth}`;
};

export const shouldRefreshQuota = (lastResetAt: string | null): boolean => {
  if (!lastResetAt) return true;
  const last = new Date(lastResetAt);
  const now = new Date();
  return last.getUTCFullYear() !== now.getUTCFullYear() || last.getUTCMonth() !== now.getUTCMonth();
};

export const toIsoString = (date: Date = new Date()): string => date.toISOString();

export const daysAgoIso = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString();
};
