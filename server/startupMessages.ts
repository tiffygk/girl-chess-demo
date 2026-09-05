// The three sentences a person sees when the server starts or refuses to.
// Pure functions so they are tested without binding a port.
export function listenErrorMessage(err: unknown, port: number): string {
  const code = (err as { code?: string })?.code;
  if (code === "EADDRINUSE") {
    // with `npm run dev` the vite half and the watcher stay alive after the server refuses,
    // so the person must stop them first.
    return `port ${port} is already in use by another program. press Ctrl+C, then run PORT=${port + 1} npm run dev, or quit that program and try again.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `girl chess could not open port ${port}: ${msg}`;
}

export function startupFailureMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return `girl chess could not start: ${msg}`;
}

export function openUrlMessage(vitePort: string | undefined): string {
  return `open http://localhost:${Number(vitePort) || 5173} in your browser`;
}
