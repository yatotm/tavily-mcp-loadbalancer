import { randomUUID } from 'node:crypto';
import { mcpObjects } from '../loadbalancer/error-classifier.js';
import type { ExaCharge } from '../data/exa-billing-store.js';
// Source: https://exa.ai/docs/admin/pricing (2026-11-03), and official MCP request builders.
export const EXA_PRICE_VERSION = '2026-11-03';
const searchPrices: Record<string, number> = { lite: .004, instant: .004, auto: .007, fast: .007, deep: .012, 'deep-lite': .012, 'deep-reasoning': .015 };
const effortPrices: Record<string, number> = { minimal: .012, low: .025, medium: .1, high: .5, xhigh: 1 };
const searchTools = new Set(['web_search_exa','web_search_advanced_exa','company_research_exa','people_search_exa','linkedin_search_exa','get_code_context_exa','deep_search_exa']);
const finiteCost = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const round = (v: number) => Math.round(v * 1e6) / 1e6;
export function exaCharge(tool: string, args: Record<string, any>, result: any, keyId: number, failed = false): ExaCharge | null {
  const objects = mcpObjects(result);
  const task = objects.find(o => typeof (o.researchId ?? o.id) === 'string' && (o.status || o.researchId));
  const taskId = task?.researchId ?? task?.id ?? args.runId ?? args.researchId;
  const isTask = ['agent_run','deep_researcher_start','deep_researcher_check'].includes(tool);
  const operationId = isTask && taskId ? `exa:${keyId}:task:${taskId}` : `exa:${keyId}:request:${randomUUID()}`;
  const detail: Record<string, any> = { priceVersion: EXA_PRICE_VERSION };
  const make = (amount: number | null, source: ExaCharge['source']): ExaCharge => ({ amount, source, operationId, tool, detail });
  // Read only protocol-level cost fields; never scan search documents for dollar amounts.
  for (const obj of [result?._meta, ...objects]) {
    const value = obj?.costDollars;
    const amount = finiteCost(value) ? value : value?.total;
    if (finiteCost(amount)) { detail.upstream = value; return make(round(amount), 'reported'); }
  }
  if (failed) return isTask && taskId ? make(null, 'unknown') : null;
  if (searchTools.has(tool)) {
    const type = tool === 'get_code_context_exa' ? 'lite' : tool === 'deep_search_exa' ? args.type || 'deep' : args.type || 'auto';
    const fallback = tool === 'company_research_exa' ? 3 : ['people_search_exa','linkedin_search_exa'].includes(tool) ? 5 : ['get_code_context_exa','deep_search_exa'].includes(tool) ? 8 : 10;
    const n = typeof args.numResults === 'number' && args.numResults > 0 ? args.numResults : fallback;
    const summaryPages = args.enableSummary ? n * (1 + (Number(args.subpages) || 0)) : 0;
    Object.assign(detail, { endpoint: '/search', type, numResults: n, summaryPages, basis: 'official MCP request parameters; returned page counts and enterprise discounts may differ' });
    if (searchPrices[type] === undefined) return make(null, 'unknown');
    return make(round(searchPrices[type] + Math.max(0, n - 10) * .001 + summaryPages * .001), 'estimated');
  }
  if (tool === 'web_fetch_exa' || tool === 'crawling_exa') {
    const urls = Array.isArray(args.urls) ? args.urls.length : 0;
    Object.assign(detail, { endpoint: '/contents', pages: urls, contentTypes: ['text'], basis: 'requested URLs; failed pages may not be billed' });
    return urls ? make(round(urls * .001), 'estimated') : make(null, 'unknown');
  }
  if (isTask) {
    // A poll updates the original task, never books a second charge. Metered jobs await upstream cost.
    const active = tool === 'deep_researcher_start' || ['running','queued','pending'].includes(task?.status);
    if (active) return make(null, 'pending');
    if (tool === 'agent_run' && !args.runId && !args.dataSources?.length && effortPrices[args.effort || 'low'] !== undefined) {
      Object.assign(detail, { endpoint: '/agent/runs', effort: args.effort || 'low', basis: 'fixed effort; excludes separately billed enrichment' });
      return make(effortPrices[args.effort || 'low'], 'estimated');
    }
    Object.assign(detail, { basis: 'metered or resumed job; awaiting authoritative costDollars' });
    return make(null, 'unknown');
  }
  return make(null, 'unknown');
}
