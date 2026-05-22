const sensitiveKeyPattern = /api[_-]?key|authorization|token|secret|password/i;

export const redactSensitiveFields = (data: unknown): unknown => {
  if (Array.isArray(data)) {
    return data.map((item) => redactSensitiveFields(item));
  }

  if (!data || typeof data !== 'object') {
    return data;
  }

  const record = data as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (sensitiveKeyPattern.test(key)) {
        return [key, '***'];
      }
      return [key, redactSensitiveFields(value)];
    })
  );
};

export const serializePayloadForLog = (data: unknown, maxLength: number = 50000): string | null => {
  if (data === null || data === undefined) return null;

  try {
    const serialized = JSON.stringify(redactSensitiveFields(data));
    return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...(truncated)` : serialized;
  } catch {
    return null;
  }
};
