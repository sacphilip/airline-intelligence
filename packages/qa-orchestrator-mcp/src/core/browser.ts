import { dirname, join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Built-in browser tools. The orchestrator runs Playwright MCP (@playwright/mcp,
 * a dependency of this package) as a child process and re-exposes its tools, so a
 * project only needs this one MCP server for both orchestration and the browser.
 *
 * Settings (env): QA_BROWSER (chrome | firefox | webkit | msedge), QA_BROWSER_HEADLESS=1,
 * QA_BROWSER_DISABLED=1 to turn the browser tools off, QA_PLAYWRIGHT_MCP_ARGS for any
 * extra Playwright MCP command-line flags.
 */
export class BrowserBridge {
  private client: Client | null = null;
  private starting: Promise<Tool[]> | null = null;
  private tools: Tool[] = [];
  error: string | null = null;

  constructor(private readonly outputDir: string) {}

  get enabled(): boolean {
    return process.env.QA_BROWSER_DISABLED !== '1';
  }

  /** Start Playwright MCP once and list its tools. Never throws: on failure the tools are just absent. */
  listTools(): Promise<Tool[]> {
    if (!this.enabled) return Promise.resolve([]);
    this.starting ??= this.start().catch(err => {
      this.error = `Browser tools unavailable: ${(err as Error).message}`;
      process.stderr.write(`[qa-orchestrator-mcp] ${this.error}\n`);
      this.starting = null; // allow a retry on the next listing
      return [];
    });
    return this.starting;
  }

  has(name: string): boolean {
    return this.tools.some(t => t.name === name);
  }

  async call(name: string, args: Record<string, unknown> | undefined): Promise<CallToolResult> {
    await this.listTools();
    if (!this.client) throw new Error(this.error ?? 'Browser tools are not running.');
    return (await this.client.callTool({ name, arguments: args ?? {} })) as CallToolResult;
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.client = null;
  }

  private async start(): Promise<Tool[]> {
    const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
    const args = [cli, '--output-dir', join(this.outputDir, 'browser')];
    if (process.env.QA_BROWSER) args.push('--browser', process.env.QA_BROWSER);
    if (process.env.QA_BROWSER_HEADLESS === '1') args.push('--headless');
    if (process.env.QA_PLAYWRIGHT_MCP_ARGS) args.push(...process.env.QA_PLAYWRIGHT_MCP_ARGS.split(/\s+/).filter(Boolean));

    const transport = new StdioClientTransport({
      command: process.execPath,
      args,
      env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
      stderr: 'inherit', // Playwright MCP's logs go to our stderr, never to the protocol stream
    });
    const client = new Client({ name: 'qa-orchestrator-mcp', version: '0.1.0' });
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.client = client;
    this.tools = tools;
    this.error = null;
    return tools;
  }
}
