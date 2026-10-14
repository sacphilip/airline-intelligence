#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, VERSION } from './server';
import { runInit } from './init';

const [command, ...rest] = process.argv.slice(2);

if (command === 'init') {
  process.exit(runInit(rest));
}
if (command === '--version' || command === '-v') {
  process.stdout.write(`qa-orchestrator-mcp ${VERSION}\n`);
  process.exit(0);
}
if (command === '--help' || command === '-h' || command === 'help') {
  process.stdout.write(`qa-orchestrator-mcp ${VERSION}

  qa-orchestrator-mcp          start the MCP server (stdio) — what your editor runs
  qa-orchestrator-mcp init     register the server for this project (.mcp.json, .vscode/mcp.json)
                               and create qa-orchestrator.config.json; see "init --help"
  qa-orchestrator-mcp --version
`);
  process.exit(0);
}
if (command) {
  process.stderr.write(`Unknown command: ${command}. Try "qa-orchestrator-mcp --help".\n`);
  process.exit(2);
}

// Server mode. stdout carries the MCP protocol: anything printed there by accident would corrupt it.
console.log = (...args: unknown[]) => console.error(...args);

const server = createServer();
server.connect(new StdioServerTransport()).catch(err => {
  process.stderr.write(`qa-orchestrator-mcp failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});

const shutdown = () => { void server.close().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
