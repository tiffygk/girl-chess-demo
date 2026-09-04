// Security round 2026-09-04, audit finding 3. The README promises the coach
// needs only a logged-in Claude subscription and no API key. agent-sdk.ts
// already stripped ANTHROPIC_API_KEY from its child env for exactly that
// reason; claude-cli.ts (the default backend) inherited the full env, so a
// key exported in the owner's shell would have billed silently. One shared
// function, used by both backends. Built fresh from process.env on every
// call and never mutates process.env (a global delete would leak to every
// other child this process spawns: stockfish, lc0, git).
let warned = false;

export function subscriptionOnlyEnv(): NodeJS.ProcessEnv {
  const { ANTHROPIC_API_KEY, ...rest } = process.env;
  if (ANTHROPIC_API_KEY !== undefined && !warned) {
    warned = true;
    console.warn(
      "[coach] ANTHROPIC_API_KEY is set in this shell. The coach ignores it and uses your Claude login only, so nothing here bills a metered key."
    );
  }
  return rest;
}

export function resetMeteredKeyWarningForTesting(): void {
  warned = false;
}
