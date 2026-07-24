import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRouter } from './tools/tool-router.js';
import { logger } from '../utils/logger.js';

/**
 * Creates a new MCP Server instance wired to the shared ToolRouter.
 * Each transport session gets its own Server instance to avoid
 * cross-session state leakage.
 */
export function createMcpServer(toolRouter: ToolRouter): Server {
  const server = new Server(
    { name: 'tavily-mcp-loadbalancer', version: '3.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolRouter.listTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await toolRouter.callTool(name, args);
    } catch (error: any) {
      logger.error('Tool call failed', { name, error: error?.message });
      return {
        content: [{ type: 'text', text: `Error: ${error?.message || 'Unknown error'}` }],
        isError: true,
      };
    }
  });

  return server;
}
