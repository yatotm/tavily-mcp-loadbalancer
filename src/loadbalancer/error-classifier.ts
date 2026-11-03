import axios from 'axios';
import type { Provider } from '../data/database.js';

export type ErrorType = 'network' | 'rate_limit' | 'quota_exceeded' | 'auth' | 'client' | 'server' | 'unknown';
export interface ErrorClassification {
  type: ErrorType;
  shouldRetry: boolean;
  shouldDisableKey: boolean;
  retryDelay?: number;
  message: string;
  incrementErrorCount: boolean;
  code?: string;
  requestNotProcessed?: boolean;
}
const networks = new Set(['ECONNABORTED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ERR_CANCELED']);
const tags: Record<string, number> = {
  INVALID_API_KEY: 401, API_KEY_REVOKED: 401, API_KEY_EXPIRED: 401,
  NO_MORE_CREDITS: 402, API_KEY_BUDGET_EXCEEDED: 402, TEAM_BUDGET_EXCEEDED: 402,
  FEATURE_DISABLED: 403, PROHIBITED_CONTENT: 403, TEAM_BLOCKED: 403, CONTENT_FILTER_ERROR: 403,
  RATE_LIMIT_EXCEEDED: 429, CONCURRENCY_LIMIT_REACHED: 429, SERVICE_OVERLOADED: 503,
  INVALID_REQUEST_BODY: 400, INVALID_REQUEST: 400,
};
function messageOf(value: any): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(messageOf).filter(Boolean).join('; ');
  if (!value || typeof value !== 'object') return '';
  const message = [value.message, value.error, value.detail, value.msg].map(messageOf).filter(Boolean).join('; ');
  return Array.isArray(value.loc) && message ? `${value.loc.join('.')}: ${message}` : message;
}
function tagOf(value: any): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tag = [value.tag, value.code, value.error?.tag, value.error?.code].find(v => typeof v === 'string');
  return tag?.toUpperCase();
}
export function retryDelay(value: unknown): number {
  const seconds = Number(value);
  const delay = value == null ? 1000 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 24 * 3600000)) : 1000;
}
const quotaText = /(?:no more|insufficient|not enough|exhausted|out of|ran out of).{0,30}credits|credits?.{0,30}(?:exhausted|depleted|exceeded)|quota.{0,30}(?:exceeded|exhausted)|(?:exceeds?|reached).{0,40}(?:usage|pay.as.you.go|plan).{0,15}limit|insufficient balance/i;
const authText = /(?:invalid|expired|revoked|missing|disabled).{0,16}(?:api[ _-]?key|authentication)|unauthorized|(?:api[ _-]?key).{0,16}(?:invalid|expired|revoked)|(?:account|team).{0,20}(?:disabled|suspended|blocked)/i;
const rateText = /rate[ _-]?limit|too many requests|concurrency.{0,20}(?:limit|exceeded)/i;

/** Official HTTP status is authoritative. Do not classify document text as an account failure. */
export function classifyError(error: unknown, responseData?: unknown, responseStatus?: number, retryAfterHeader?: string | number, provider: Provider = 'tavily'): ErrorClassification {
  const e = error as any;
  const data = responseData ?? e?.response?.data;
  const message = messageOf(data) || (typeof e?.message === 'string' ? e.message : messageOf(error)) || 'Upstream request failed';
  let code = tagOf(data);
  if (!code) code = Object.keys(tags).find(tag => new RegExp(`\\b${tag}\\b`).test(message));
  let status = responseStatus ?? e?.response?.status;
  // Only called for an error envelope; these fallbacks never inspect successful results.
  status ??= code ? tags[code] : undefined;
  if (!status && authText.test(message)) status = 401;
  if (!status && rateText.test(message)) status = 429;
  if (!status && quotaText.test(message)) status = 402;
  let type: ErrorType = 'unknown';
  if (status === 401) type = 'auth';
  else if (status === 402 || (provider === 'tavily' && [432, 433].includes(status))) type = 'quota_exceeded';
  else if (status === 403) type = code === 'TEAM_BLOCKED' || authText.test(message) || (provider === 'tavily' && /unpaid|payment method/i.test(message)) ? 'auth' : 'client';
  else if (status === 429) type = 'rate_limit';
  else if (status >= 500) type = 'server';
  else if (status >= 400) type = 'client';
  else if (networks.has(e?.code) || (axios.isAxiosError(error) && !e.response && /network|timeout/i.test(message))) type = 'network';
  if (provider === 'tavily' && status === 432) code = 'TAVILY_PLAN_LIMIT';
  if (provider === 'tavily' && status === 433) code = 'TAVILY_PAYG_LIMIT';
  return {
    type, message, code,
    shouldRetry: ['network', 'rate_limit', 'server'].includes(type),
    shouldDisableKey: type === 'auth' || type === 'quota_exceeded',
    incrementErrorCount: type === 'auth',
    ...(type === 'rate_limit' ? { retryDelay: retryDelay(retryAfterHeader ?? e?.response?.headers?.['retry-after'] ?? data?.retryAfter) } : {}),
    ...(provider === 'exa' && status === 503 && code === 'SERVICE_OVERLOADED' ? { requestNotProcessed: true } : {}),
  };
}

/** Successful /contents responses can contain URL-level statuses/errors: leave those alone. */
export function classifyResponsePayload(payload: any, provider: Provider = 'tavily'): ErrorClassification | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const explicitFailure = Boolean(payload.error) || payload.success === false || ['error', 'failed'].includes(payload.status)
    || (provider === 'tavily' && Boolean(payload.detail)) || Boolean(tagOf(payload) && tags[tagOf(payload)!]);
  if (!explicitFailure) return null;
  const status = [payload.statusCode, payload.status_code, payload.httpStatusCode].find(v => typeof v === 'number' && v >= 400 && v < 600);
  const result = classifyError(new Error(messageOf(payload) || 'Upstream returned an error'), payload, status, undefined, provider);
  return result.type === 'unknown' ? { ...result, type: 'client' } : result;
}

export function mcpObjects(result: any): any[] {
  const values: any[] = [];
  if (result?.structuredContent && typeof result.structuredContent === 'object') values.push(result.structuredContent);
  for (const block of result?.content || []) {
    if (block?.type !== 'text') continue;
    try { const value = JSON.parse(block.text); if (value && typeof value === 'object' && !Array.isArray(value)) values.push(value); } catch { /* Plain text MCP output. */ }
  }
  return values;
}
export function classifyMcpResult(result: any, provider: Provider): ErrorClassification | null {
  if (result?._meta?.['ai.exa/rateLimited']) return classifyError(new Error('Exa MCP rate limit'), { tag: 'RATE_LIMIT_EXCEEDED' }, 429, undefined, provider);
  for (const value of mcpObjects(result)) {
    const failure = classifyResponsePayload(value, provider);
    if (failure) return failure;
  }
  const texts: string[] = (result?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text);
  // Exa's official formatter: "web_search_exa error (402): ...". Require the exact prefix.
  const formatted = texts.find(t => /^(?:[a-z_]+_exa|agent_run|deep_researcher_(?:start|check)) error(?: \(\d{3}\))?:/i.test(t));
  if (!result?.isError && !formatted) return null;
  const message = formatted || texts.join('\n') || 'Upstream MCP returned an error';
  const status = message.match(/\berror \((\d{3})\):|\b(?:HTTP|status(?: code)?)[: ]+(\d{3})\b/i);
  const failure = classifyError(new Error(message), { message }, status ? Number(status[1] || status[2]) : undefined, undefined, provider);
  return failure.type === 'unknown' ? { ...failure, type: 'client' } : failure;
}
