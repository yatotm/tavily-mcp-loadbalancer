import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ToolRouter } from './tools/tool-router.js';
import { logger } from '../utils/logger.js';

export class McpStdioServer {
  private server: Server;

  constructor(private toolRouter: ToolRouter) {
    this.server = new Server({
      name: 'tavily-mcp-loadbalancer',
      version: '3.0.0',
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.toolRouter.listTools() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.toolRouter.callTool(name, args);
        return result;
      } catch (error: any) {
        logger.error('Tool call failed', { name, error: error?.message });
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error?.message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      logger.error('MCP server error', { error: (error as Error).message });
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('MCP stdio server running');
  }
}
