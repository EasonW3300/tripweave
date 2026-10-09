export function formatSessionEvent(event: 'snapshot' | 'update', payload: unknown): string {
  // JSON escaping keeps embedded newlines inside one SSE data line.
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}
