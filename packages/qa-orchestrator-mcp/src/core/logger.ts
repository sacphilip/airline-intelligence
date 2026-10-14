// Output for orchestrator runs. Over MCP stdio, stdout carries the protocol, so
// progress goes to stderr and is also collected so a tool can return it.

let buffer: string[] | null = null;

export function log(...parts: unknown[]): void {
  const line = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  process.stderr.write(line + '\n');
  buffer?.push(line);
}

/** Run `fn`, returning its result together with everything it logged. */
export async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; output: string }> {
  const previous = buffer;
  buffer = [];
  const lines = buffer;
  try {
    const result = await fn();
    return { result, output: lines.join('\n') };
  } finally {
    buffer = previous;
  }
}
