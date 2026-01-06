import { toolDefinitions } from './definitions.js';
import { TavilyClient } from '../../client/tavily-client.js';
import { formatResults, formatCrawlResults, formatMapResults } from '../../client/response-formatter.js';
import { getRuntimeConfig } from '../../utils/runtime-config.js';

const removeEmpty = (params: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }
  return cleaned;
};

export class ToolRouter {
  constructor(private tavilyClient: TavilyClient) {}

  listTools() {
    return toolDefinitions;
  }

  async callTool(name: string, args: any) {
    switch (name) {
      case 'tavily-search':
      case 'search': {
        const runtime = getRuntimeConfig();
        const defaults = runtime.defaultParameters || {};
        const payload: Record<string, unknown> = {
          query: args?.query,
          search_depth: args?.search_depth,
          topic: args?.topic,
          days: args?.days,
          time_range: args?.time_range,
          max_results: args?.max_results,
          include_images: args?.include_images,
          include_image_descriptions: args?.include_image_descriptions,
          include_raw_content: args?.include_raw_content,
          include_domains: Array.isArray(args?.include_domains) ? args.include_domains : [],
          exclude_domains: Array.isArray(args?.exclude_domains) ? args.exclude_domains : [],
          country: args?.country,
          include_favicon: args?.include_favicon,
          start_date: args?.start_date,
          end_date: args?.end_date,
        };

        for (const key of Object.keys(defaults)) {
          if (payload[key] === undefined || payload[key] === null) {
            payload[key] = (defaults as any)[key];
          }
        }

        if (payload.country) {
          payload.topic = 'general';
        }

        if ((payload.start_date || payload.end_date) && (payload.time_range || payload.days)) {
          payload.time_range = undefined;
          payload.days = undefined;
        }

        const cleaned = removeEmpty(payload);
        const response = await this.tavilyClient.search(cleaned);
        return {
          content: [{ type: 'text', text: formatResults(response) }],
        };
      }

      case 'tavily-extract': {
        const payload: Record<string, unknown> = {
          urls: Array.isArray(args?.urls) ? args.urls : [],
          extract_depth: args?.extract_depth,
          include_images: args?.include_images,
          format: args?.format,
          include_favicon: args?.include_favicon,
          query: args?.query,
        };
        const cleaned = removeEmpty(payload);
        const response = await this.tavilyClient.extract(cleaned);
        return {
          content: [{ type: 'text', text: formatResults(response) }],
        };
      }

      case 'tavily-crawl': {
        const payload: Record<string, unknown> = {
          url: args?.url,
          max_depth: args?.max_depth,
          max_breadth: args?.max_breadth,
          limit: args?.limit,
          instructions: args?.instructions,
          select_paths: Array.isArray(args?.select_paths) ? args.select_paths : [],
          select_domains: Array.isArray(args?.select_domains) ? args.select_domains : [],
          allow_external: args?.allow_external,
          extract_depth: args?.extract_depth,
          format: args?.format,
          include_favicon: args?.include_favicon,
          chunks_per_source: 3,
        };
        const cleaned = removeEmpty(payload);
        const response = await this.tavilyClient.crawl(cleaned);
        return {
          content: [{ type: 'text', text: formatCrawlResults(response) }],
        };
      }

      case 'tavily-map': {
        const payload: Record<string, unknown> = {
          url: args?.url,
          max_depth: args?.max_depth,
          max_breadth: args?.max_breadth,
          limit: args?.limit,
          instructions: args?.instructions,
          select_paths: Array.isArray(args?.select_paths) ? args.select_paths : [],
          select_domains: Array.isArray(args?.select_domains) ? args.select_domains : [],
          allow_external: args?.allow_external,
        };
        const cleaned = removeEmpty(payload);
        const response = await this.tavilyClient.map(cleaned);
        return {
          content: [{ type: 'text', text: formatMapResults(response) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
