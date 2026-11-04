import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { portalInstructions, portalTools, executeTool, toolError } from './tools.js';
import type { Actor } from './data.js';
import { inspectDataModel } from './research.js';

export function createMcpServer(actor: Actor) {
  const server = new McpServer(
    { name: 'findos-portal', version: '1.1.0' },
    { instructions: portalInstructions }
  );
  for (const tool of portalTools.filter((tool) => !tool.writes || actor.canCommit)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: !tool.writes,
          destructiveHint: Boolean(tool.writes),
          openWorldHint: false,
        },
      },
      async (input) => {
        try {
          const result = await executeTool(actor, tool.name, input);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify(toolError(error)) }],
          };
        }
      }
    );
  }
  server.registerResource(
    'data-model',
    'findos://data-model',
    {
      description:
        'Complete authorized entity/field/reference map, domain rules and query examples',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await inspectDataModel(actor)),
        },
      ],
    })
  );
  server.registerPrompt(
    'portal-assistant',
    { description: 'Workflow for researching data, building KPIs and reviewing changes' },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: portalInstructions } }],
    })
  );
  return server;
}
