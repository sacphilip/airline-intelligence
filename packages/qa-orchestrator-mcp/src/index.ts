#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './server';

// stdout carries the MCP protocol: anything printed there by accident would corrupt it.
console.log = (...args: unknown[]) => console.error(...args);

if (process.argv.includes('--version')) {
  process.stderr.write(`qa-orchestrator-mcp ${VERSION}\n`);
  process.exit(0);
}

const server = createServer();
server.connect(new StdioServerTransport()).catch(err => {
  process.stderr.write(`qa-orchestrator-mcp failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});

const shutdown = () => { void server.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
