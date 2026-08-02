// B-stream (2026-07-27, coach-truth-speed round): a pure reducer over raw
// SSE text chunks arriving from POST /api/game/:id/chat/stream (server/
// index.ts). Kept out of CoachChat.tsx (a .tsx file gets no unit tests per
// this project's convention -- see chatFocus.ts/chatThread.ts's own header
// comments) so the chunk-splitting logic has direct test coverage.
//
// No fetch/EventSource/DOM access here -- CoachChat.tsx owns the actual
// `fetch` + `ReadableStream` plumbing and feeds each decoded text chunk into
// pushChunk below, one call per chunk, threading `next` back in as the
// following call's `state`.
//
// Frame wire shape (server/index.ts's writeFrame): one blank-line-terminated
// SSE record per frame --
//   event: <status|delta|redraft|done|error>\n
//   data: <json>\n
//   \n
// A chunk boundary from the network has NO relationship to a frame boundary
// -- a single frame can arrive split across two chunks, and two (or more)
// complete frames can arrive in a single chunk. This module buffers whatever
// text hasn't yet resolved into a complete "...\n\n"-terminated block and
// only ever emits fully-parsed frames.
import type { ChatResponse } from "./api";

// Task 1c (coach-truth-speed latency round, 2026-08-02): the four staged
// status phases, REAL pipeline events only -- never carries prose. Its own
// union type (not a bare string) so an unrecognized phase is a type error
// at every call site, not a silent no-op.
export type ChatStatusPhase = "thinking" | "drafting" | "checking" | "redrafting";

export type ChatStreamFrame =
  | { event: "delta"; data: { text: string } }
  | { event: "redraft"; data: Record<string, never> }
  | { event: "status"; data: { phase: ChatStatusPhase } }
  | { event: "done"; data: ChatResponse }
  | { event: "error"; data: ChatResponse };

export interface ChatStreamState {
  buffer: string;
}

export function initChatStream(): ChatStreamState {
  return { buffer: "" };
}

const EVENT_PREFIX = "event: ";
const DATA_PREFIX = "data: ";
const KNOWN_EVENTS = new Set(["delta", "redraft", "status", "done", "error"]);

// A single "event: X\ndata: Y" block (no trailing blank line -- the caller
// below has already split on "\n\n"). Returns null for anything malformed or
// unrecognized rather than throwing -- a stray/incomplete block should never
// crash the reducer; the caller just drops it and keeps going.
function parseFrame(block: string): ChatStreamFrame | null {
  const lines = block.split("\n");
  const eventLine = lines.find((l) => l.startsWith(EVENT_PREFIX));
  const dataLine = lines.find((l) => l.startsWith(DATA_PREFIX));
  if (!eventLine || !dataLine) return null;
  const event = eventLine.slice(EVENT_PREFIX.length).trim();
  if (!KNOWN_EVENTS.has(event)) return null;
  try {
    const data = JSON.parse(dataLine.slice(DATA_PREFIX.length));
    return { event, data } as ChatStreamFrame;
  } catch {
    return null;
  }
}

// Feed one raw text chunk in. Returns every frame that became complete as a
// result (zero, one, or several) plus the next state to thread into the
// following call. Pure -- same (state, chunk) always yields the same result.
export function pushChunk(state: ChatStreamState, chunk: string): { frames: ChatStreamFrame[]; next: ChatStreamState } {
  const combined = state.buffer + chunk;
  const blocks = combined.split("\n\n");
  // The last element is whatever text follows the final "\n\n" seen so far --
  // either "" (the chunk ended exactly on a frame boundary) or a partial
  // frame still waiting on the rest of its "data:" line / its own trailing
  // blank line. Never treated as complete.
  const leftover = blocks.pop() ?? "";
  const frames: ChatStreamFrame[] = [];
  for (const block of blocks) {
    if (block.trim().length === 0) continue;
    const frame = parseFrame(block);
    if (frame) frames.push(frame);
  }
  return { frames, next: { buffer: leftover } };
}
