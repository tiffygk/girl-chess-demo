import { useEffect, useRef, useState } from "react";
import { chatWithCoach, streamChatWithCoach, rateTrace, type ChatContext, type ChatHistoryMessage, type ChatResponse, type CoachProbe } from "./api";
import { anchorForFocus, focusKey, historyToThread, shouldInjectAnchor, type ThreadEntry } from "./chatThread";
import type { ChatStatusPhase } from "./chatStream";

// Task 1c (coach-truth-speed latency round, 2026-08-02): the staged
// perceived-progress copy, driven by REAL pipeline events only (server/
// coach/chat.ts's onAttemptStart/onValidateStart, server/index.ts's status
// frame) -- never unvalidated prose (owner ruling stands). "redrafting"
// falls back to the same "thinking" copy: by the time that phase's frame
// reaches the client, onRedraft has already fired and swapped the render
// into the muted "let me redo that" bubble below, so this entry is a type-
// completeness fallback, not a copy that's actually seen.
const STATUS_PHASE_COPY: Record<ChatStatusPhase, string> = {
  thinking: "cookie is thinking…",
  drafting: "cookie is drafting…",
  checking: "cookie is checking her work…",
  redrafting: "cookie is thinking…",
};

// Increment 3.9, Task 4 (F19): thumbs up/down with feedback capture on any
// traced coach output. Exported here and imported by GamePage's coach
// corner so both surfaces (chat replies AND narration) render the exact
// same 16px pair rather than two hand-rolled copies. Scope per declared cut
// #3: renders beside anything carrying a traceId -- the client-derived
// debrief lesson/bullets have no server trace and get no thumbs (deferred
// to increment 4).
//
// A thumbs-down click records the plain -1 immediately (so "skip the text"
// really does keep the -1, per the brief) and reveals a one-line whisper
// input -- never a modal, rating should feel like a flick. Submitting text
// re-rates with the feedback attached; re-rating (switching thumbs, or
// re-submitting) overwrites server-side (rateAdviceTrace: latest wins), and
// this component mirrors that locally.
const THUMB_UP_PATH =
  "M1 21h4V9H1v12zM23 10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
const THUMB_DOWN_PATH =
  "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05C1.05 11.5 1 11.75 1 12v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z";

export function ThumbRating({ traceId }: { traceId: number }) {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [feedback, setFeedback] = useState("");

  const rateUp = () => {
    setRating(1);
    setShowInput(false);
    setFeedback("");
    rateTrace(traceId, 1).catch(() => undefined);
  };

  const rateDown = () => {
    setRating(-1);
    setShowInput(true);
    rateTrace(traceId, -1).catch(() => undefined); // skipping the text below keeps this -1
  };

  const submitFeedback = () => {
    const text = feedback.trim();
    // Reviewer fix (Task 4 follow-up): an empty blur/Enter still closes the
    // whisper input -- the plain -1 from rateDown's own click already
    // stands, there's just no feedback text to attach. Only a non-empty
    // submit makes the extra rateTrace call.
    if (text) rateTrace(traceId, -1, text).catch(() => undefined);
    setShowInput(false);
  };

  const onFeedbackKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submitFeedback();
  };

  return (
    <div className="thumb-rating">
      <div className="thumb-pair">
        <button
          type="button"
          aria-label="thumbs up"
          aria-pressed={rating === 1}
          className={rating === 1 ? "thumb-btn thumb-up chosen" : "thumb-btn thumb-up"}
          onClick={rateUp}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d={THUMB_UP_PATH} />
          </svg>
        </button>
        <button
          type="button"
          aria-label="thumbs down"
          aria-pressed={rating === -1}
          className={rating === -1 ? "thumb-btn thumb-down chosen" : "thumb-btn thumb-down"}
          onClick={rateDown}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
            <path d={THUMB_DOWN_PATH} />
          </svg>
        </button>
      </div>
      {showInput && (
        <div className="thumb-feedback-row">
          <input
            type="text"
            className="thumb-feedback-input"
            value={feedback}
            placeholder="tell the coach what was off"
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={onFeedbackKeyDown}
            onBlur={submitFeedback}
          />
        </div>
      )}
    </div>
  );
}

// Increment 3.9, Task 3 (F16 chat client): the pull-based "chat with the
// coach" drawer. Distinct surface from coach's corner (narrate()) — the
// player initiates every message here, so it's reachable whenever there's a
// game to talk about, independent of the Guardian Angel/Silent Partner
// toggle (panel B1: coachOn only suppresses unsolicited verdicts, never a
// pull the player asked for). GamePage owns the visibility gate (gameId
// present OR reviewGame, hidden mid-replay/mid-cinematic) and passes a
// concrete gameId — this component has no opinion about when it should
// exist, only about what it looks like once mounted.
//
// Fix (task-reviewer, post task-3 approval): this component is now ALWAYS
// mounted by GamePage (same precedent as PastGamesDrawer's `open` prop),
// with `hidden` controlling visibility instead of a conditional unmount.
// State (messages/draft/open/pending) resets ONLY on a gameId change, per
// the brief — a rewind or the takedown cinematic toggling `hidden` must
// never wipe an in-progress conversation about the same game.

const CHAT_MAX_LEN = 500;

// chat-in-corner, wave 1 (spec B4): the message state is now a ThreadEntry
// union (see chatThread.ts) -- a "message" entry carries the same fields the
// old local ChatBubble type did (cause is the Task 8 owner-ruled
// "templates-only" vs "backend-down" distinction; traceId is Task 4's F19
// thumb-rating hook), plus two new presentational kinds, "context-anchor"
// and "intent-marker", for the provenance-anchor injection below.

// Client-owned fallback for the rare case the server call itself fails
// (network error, or the defensive ok:false envelope) — deliberately not
// the persona's own redirect copy (server-owned voice), just a plain
// "something broke, try again" so ownership of coach voice stays server-side.
const FALLBACK_TEXT = "something went wrong there, try asking again.";

export interface CoachChatProps {
  // number | null (not just number): GamePage keeps this component always
  // mounted, including before any game exists, so a gameId isn't always
  // available yet — `hidden` covers that case (and every other visibility
  // rule) rather than the caller having to conditionally render at all.
  gameId: number | null;
  mode: "live" | "review";
  buildContext: () => ChatContext;
  hidden: boolean;
  // Task 5 (F17): "claude" | "ollama" | "template" — GamePage owns the
  // localStorage-synced settings-popover state; this component has no
  // opinion of its own, it just forwards whatever it's given on every send.
  backendPref: string;
  // Increment 3.95, Task 7 ("ask about this"): an incrementing token GamePage
  // bumps to force this already-mounted drawer open from an external click
  // (a hint's "ask about this", or a turning-point card's) — the normal
  // "chat with the coach" opener button stays the only OTHER way to open it.
  // Optional/undefined is a no-op (no external opener wired), so every other
  // caller of this component is unaffected.
  openSignal?: number;
  // chat-in-corner, wave 1 (spec B3): the focus the openSignal bump is
  // scoped to, if any -- GamePage's own chatFocus state (see chatFocus.ts),
  // mirrored here so the provenance-anchor injection can read it at the
  // moment the drawer is forced open. Optional/undefined (no focus wired,
  // or a plain opener click) injects nothing, same no-op precedent as
  // openSignal itself.
  hintFocus?: ChatContext["hintFocus"];
  turningPointFocus?: ChatContext["turningPointFocus"];
  // Task 3 (stranger-clones-and-plays): fetched once by GamePage on mount
  // and passed down so this component stays presentational (the static-
  // render test drives it directly). null/undefined (not yet fetched, or
  // the fetch failed) renders nothing extra -- same as today.
  coachStatus?: CoachProbe | null;
  // Task 11.2 (stranger-clones-and-plays round, resume-brings-back-chat):
  // this game's persisted chat_messages rows, fetched by GamePage's
  // resumeGame via fetchChatHistory and handed down so this component
  // stays presentational (same precedent as coachStatus above). Seeds the
  // thread on the CURRENT gameId once, in place of the panel coming back
  // empty on resume -- see the seeding effect below for why it's a
  // separate effect from the gameId reset rather than folded into it.
  // null/undefined (no game to resume, or the fetch failed/is still in
  // flight) seeds nothing, same as an empty history array.
  history?: ChatHistoryMessage[] | null;
}

export function CoachChat({
  gameId,
  mode,
  buildContext,
  hidden,
  backendPref,
  openSignal,
  hintFocus,
  turningPointFocus,
  coachStatus,
  history,
}: CoachChatProps) {
  const [open, setOpen] = useState(false);
  // Lazy initializer (not `useState<ThreadEntry[]>([])`): seeds the FIRST
  // render straight from `history` if the caller already has it at mount
  // time -- this is what lets a static render (CoachChat.test.tsx, which
  // never runs effects) prove seeding works without a DOM. The gameId
  // reset effect below still wipes this on every later game-id change (this
  // component stays mounted across games), and the seeding effect after it
  // re-populates once history for the NEW game arrives -- see that effect's
  // comment for why late-arriving history needs its own effect.
  const [messages, setMessages] = useState<ThreadEntry[]>(() => historyToThread(history));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  // B-stream (2026-07-27, coach-truth-speed round): the in-flight coach
  // reply's EPHEMERAL streaming state -- deliberately NOT a ThreadEntry.
  // It only ever exists between "send" and the terminal done/error frame (or
  // the JSON fallback's own resolution), at which point it is cleared and a
  // real settled ThreadEntry is pushed into `messages`, same shape as
  // before this wave (thumbs/chip only ever render on a settled message).
  // `muted` is the D-task "let me redo that" state a `redraft` frame puts
  // the bubble into; the FIRST delta that arrives after a redraft replaces
  // this bubble's text rather than appending to it (see send() below).
  const [streamDraft, setStreamDraft] = useState<{ text: string; muted: boolean } | null>(null);
  // Task 1c: the staged status phase, null until the first status frame of
  // a request lands. Reset alongside streamDraft on every new send and on a
  // game-id change -- same lifecycle, it only ever describes the CURRENT
  // in-flight request.
  const [statusPhase, setStatusPhase] = useState<ChatStatusPhase | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestTokenRef = useRef(0);
  const openSignalRef = useRef(openSignal);
  // The key of the focus we most recently injected an anchor for -- distinct
  // from "the current focus", so a focus that clears to null and comes back
  // to the SAME key re-anchors (see shouldInjectAnchor's contract).
  const lastInjectedKeyRef = useRef<string | null>(null);
  // Task 11.2: which gameId's history has already been seeded into
  // `messages` -- a ref, not state, so it doesn't itself retrigger the
  // seeding effect below. Cleared on every gameId change so a resumed game
  // seeds once, and a later re-render carrying the same (or a stale
  // re-fetched) history array never wipes a question the player has since
  // typed into this thread.
  const seededHistoryGameIdRef = useRef<number | null>(null);

  // "component chat state resets when the viewed game id changes (server
  // owns durable history)" — the visible thread is per-view only; switching
  // games (new live game, or picking a different past game to review)
  // starts a fresh blank thread rather than carrying the old one over.
  useEffect(() => {
    requestTokenRef.current += 1; // drop any in-flight reply from the old game
    setMessages([]);
    setDraft("");
    setPending(false);
    setStreamDraft(null);
    setStatusPhase(null);
    setOpen(false);
    lastInjectedKeyRef.current = null;
    seededHistoryGameIdRef.current = null;
  }, [gameId]);

  // Task 11.2 (stranger-clones-and-plays round): seeds `messages` from
  // `history` once per gameId. This is a SEPARATE effect from the reset
  // above, keyed on [gameId, history] rather than [gameId] alone, because
  // GamePage's resumeGame calls setGameId(id) before its fetchChatHistory
  // call has settled -- so `history` for the new game typically arrives on
  // a LATER render than the gameId change itself, after the reset effect
  // has already run and cleared messages to []. Folding this into the
  // reset effect would either fire on the stale (previous game's) history,
  // or require reading history through a ref to dodge that -- keeping it
  // separate and re-running whenever `history` changes is simpler and
  // correct either way. The ref guard is what stops a later render with an
  // unchanged (or a stale, re-fetched-identical) history value from wiping
  // out a question the player has typed since the seed landed.
  useEffect(() => {
    if (gameId == null) return;
    if (!history || history.length === 0) return;
    if (seededHistoryGameIdRef.current === gameId) return;
    seededHistoryGameIdRef.current = gameId;
    setMessages(historyToThread(history));
  }, [gameId, history]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, pending, streamDraft, open]);

  // Task 7: an "ask about this" click bumps openSignal — this only reacts to
  // a genuine CHANGE (the ref, not a dependency-array staleness check, is
  // what makes the first render a no-op even though openSignal starts at a
  // real number rather than undefined).
  // chat-in-corner, wave 1 (spec B3): the same bump that forces the drawer
  // open also carries provenance -- inject a restating anchor ONCE on
  // transition into a new focus, never on every bump/send (shouldInjectAnchor
  // enforces that; a plain opener with no focus, or a re-bump within the
  // same focus, injects nothing).
  useEffect(() => {
    if (openSignal !== undefined && openSignal !== openSignalRef.current) {
      openSignalRef.current = openSignal;
      setOpen(true);
      const nextKey = focusKey(hintFocus, turningPointFocus);
      if (shouldInjectAnchor(lastInjectedKeyRef.current, nextKey)) {
        const anchor = anchorForFocus(hintFocus, turningPointFocus);
        if (anchor) {
          setMessages((prev) => [...prev, anchor, { kind: "intent-marker" }]);
          lastInjectedKeyRef.current = nextKey;
        }
      }
    }
  }, [openSignal, hintFocus, turningPointFocus]);

  // Single in-flight request (panel A11): send is disabled while pending is
  // true, and this guard is the belt to that button's suspenders — Enter
  // can't race a click past the disabled state. The token guard additionally
  // drops a reply that lands after the game view has already moved on,
  // which is also what guarantees a traceId (once Task 4 wires thumbs to
  // it) always binds to the bubble it actually answered.
  const send = () => {
    if (gameId == null) return; // no game to talk about yet — hidden covers this in the UI too
    const text = draft.trim();
    if (!text || pending) return;
    const token = ++requestTokenRef.current;
    setPending(true);
    setMessages((prev) => [...prev, { kind: "message", role: "user", text }]);
    setDraft("");
    setStreamDraft(null);
    setStatusPhase(null);
    const context = buildContext();

    // Shared terminal handling for BOTH the streaming path's done/error
    // frames and the JSON-fallback promise's resolve/reject -- one settled
    // ThreadEntry either way, same shape chat had before this wave (thumbs/
    // chip only ever attach here, never to the ephemeral streamDraft).
    const settle = (res: ChatResponse | null) => {
      if (requestTokenRef.current !== token) return; // superseded — drop it
      setStreamDraft(null);
      setStatusPhase(null);
      // Minor fix (task-reviewer, pre-existing): `res.text != null` rather
      // than truthiness — an empty-string reply is a real (if odd) reply,
      // not a failure, and shouldn't fall through to the fallback copy.
      if (res && res.ok && res.text != null) {
        setMessages((prev) => [
          ...prev,
          { kind: "message", role: "coach", text: res.text!, cause: res.cause, traceId: res.traceId },
        ]);
      } else {
        setMessages((prev) => [...prev, { kind: "message", role: "coach", text: FALLBACK_TEXT }]);
      }
      setPending(false);
    };

    // Fall back to the existing JSON endpoint's exact pre-this-wave promise
    // chain -- reserved for a stream that failed to OPEN at all (see
    // streamChatWithCoach's own doc comment), so a transport problem
    // degrades to today's behavior rather than to nothing.
    const jsonFallback = () => {
      chatWithCoach(gameId, { message: text, context, backendPref })
        .then((res) => settle(res))
        .catch(() => settle(null));
    };

    // True from the moment a `redraft` frame lands until the NEXT delta
    // arrives -- that next delta replaces the muted draft's text rather than
    // appending to it (spec: "the regen streams over the same bubble,
    // replacing rather than appending"). Plain closure var, not React state:
    // every callback below fires sequentially off the same read loop in
    // api.ts, never concurrently, so there is no race to guard against.
    let awaitingReplacement = false;

    streamChatWithCoach(gameId, { message: text, context, backendPref }, {
      onDelta: (delta) => {
        if (requestTokenRef.current !== token) return;
        setStreamDraft((prev) => {
          if (awaitingReplacement) {
            awaitingReplacement = false;
            return { text: delta, muted: false };
          }
          return { text: (prev?.text ?? "") + delta, muted: false };
        });
      },
      onRedraft: () => {
        if (requestTokenRef.current !== token) return;
        awaitingReplacement = true;
        setStreamDraft((prev) => ({ text: prev?.text ?? "", muted: true }));
      },
      // Task 1c: drives the phase copy in the "cookie is thinking…" bubble
      // below. Real pipeline events only -- never carries prose.
      onStatus: (phase) => {
        if (requestTokenRef.current !== token) return;
        setStatusPhase(phase);
      },
      onDone: (res) => settle(res),
      onError: (res) => settle(res),
    }).catch(() => {
      // streamChatWithCoach only ever rejects when the stream failed to
      // open at all (see its own doc comment) -- anything past that point
      // resolves via onError above instead.
      if (requestTokenRef.current !== token) return;
      jsonFallback();
    });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    send();
  };

  // Wave 3 (chat-in-corner, B1/B5): no game yet means there is nothing to
  // dock, and the >=1200px grid must not reserve the rail column pregame --
  // that is the ONLY unmount condition left. Once a game exists the root
  // stays in the DOM even while `hidden` (a debrief rewind, or the takedown
  // cinematic) so the rail column never collapses and re-centers the board
  // mid-game: `hidden` is a CSS visibility flag on the same mounted node,
  // and messages/draft/open live in React state either way, so un-hiding
  // picks the conversation back up exactly where it was.
  if (gameId == null) return null;

  const emptyCopy = mode === "review" ? "ask about this game." : "ask about the position on the board.";

  // B2/B5: an inline, collapsible panel in the coach region -- no overlay,
  // no dialog role, no focus trap, no scroll lock; the board stays playable
  // while a reply generates. Collapsed (D2 default) it is the one-line
  // "chat with cookie" opener; both branches render and CSS swaps them on
  // .chat-corner-open, which is also what lets the small-viewport media
  // query (D5) hand the space back to the board without touching state.
  // Fix round 1 review finding: the not-installed/not-signed-in check was
  // duplicated between the bubble text and its chip below -- one source
  // of truth for "coach needs setup, not just currently down".
  const coachNeedsSetup = coachStatus != null && (coachStatus.state === "not-installed" || coachStatus.state === "not-signed-in");

  return (
    <div className={open ? "chat-corner chat-corner-open" : "chat-corner"} hidden={hidden}>
      <button type="button" className="chat-corner-opener" onClick={() => setOpen(true)}>
        {/* Cookie's face joins the pill as a small STATIC leading avatar --
            component-library.html #sec-chat-opener-glyph, Variant A
            (owner-approved): glyph 21x18, gap 8px, 1px optical drop. Same
            pixel (C) glyph as the np-glyph plate below, but no plate chrome,
            no c00kie corruption here -- the opener stays candy. */}
        <svg className="np-glyph-opener" viewBox="0 0 14 12" shapeRendering="crispEdges" aria-hidden="true">
          <path fill="#FFFFFF" d="M11 0h2v1h-2zM10 1h2v1h-2zM9 2h2v1H9zM8 3h2v1H8z" />
          <path fill="#6952C4" d="M3 1h5v1H3zM1 2h8v1H1zM12 2h2v1h-2zM0 3h8v1H0zM11 3h3v1h-3zM0 4h7v1H0zM8 4h6v1H8zM0 5h6v1H0zM7 5h7v1H7zM0 6h14v1H0zM0 7h14v1H0zM1 8h12v1H1zM1 9h12v1H1zM2 10h9v1H2zM4 11h5v1H4z" />
          <path fill="#C9BFEF" d="M2 5h1v1H2zM2 6h1v1H2zM3 7h1v1H3z" />
        </svg>
        chat with cookie
      </button>
      <div className="chat-corner-panel">
        <div className="chat-corner-head">
          <div className="chat-corner-head-title">
            {/* cookie's registry entry -- same plate anatomy as np-you/
                np-mallow (PlayerBar.tsx), lavender trio, role in the elo
                seat. Glyph ported from the vault component library
                (component-library.html #cc-glyph-candidates, pixel weight
                (C): deep ink body #6952C4) -- owner-approved 2026-07-21,
                reversing the earlier no-glyph ruling. D7 ruled: the c00kie
                corruption frame, lavender shadows only. */}
            <span className="name-plate np-cookie">
              <span className="np-body">
                <svg className="np-glyph" width="28" height="24" viewBox="0 0 14 12" shapeRendering="crispEdges" aria-hidden="true">
                  <path fill="#FFFFFF" d="M11 0h2v1h-2zM10 1h2v1h-2zM9 2h2v1H9zM8 3h2v1H8z" />
                  <path fill="#6952C4" d="M3 1h5v1H3zM1 2h8v1H1zM12 2h2v1h-2zM0 3h8v1H0zM11 3h3v1h-3zM0 4h7v1H0zM8 4h6v1H8zM0 5h6v1H0zM7 5h7v1H7zM0 6h14v1H0zM0 7h14v1H0zM1 8h12v1H1zM1 9h12v1H1zM2 10h9v1H2zM4 11h5v1H4z" />
                  <path fill="#C9BFEF" d="M2 5h1v1H2zM2 6h1v1H2zM3 7h1v1H3z" />
                </svg>
                <span className="np-name">
                  <span className="np-name-real">cookie</span>
                  <span className="np-name-glitch" aria-hidden="true">c00kie</span>
                </span>
                <span className="np-div" aria-hidden="true"></span>
                <span className="bar-elo">coach</span>
              </span>
            </span>
            <span className="chat-kicker">coach chat</span>
          </div>
          <button type="button" className="chat-corner-collapse" aria-label="collapse chat" onClick={() => setOpen(false)}>
            <svg width="8" height="6" viewBox="0 0 8 6" aria-hidden="true">
              <path d="M0 0h8L4 6z" fill="#6952C4" />
            </svg>
          </button>
        </div>
        <div className="chat-corner-thread" ref={listRef}>
          {messages.length === 0 && <p className="chat-empty">{emptyCopy}</p>}
          {messages.map((m, i) => {
            // D3 ruled: the anchor is a distinct provenance card -- sharp
            // kicker chip + the exact hint/turning-point text, a record of
            // a moment rather than a turn of speech.
            if (m.kind === "context-anchor") {
              return (
                <div key={i} className="chat-anchor">
                  <span className="chat-anchor-kicker">
                    {m.label}
                    {m.moveNumber ? ` · move ${m.moveNumber}` : ""}
                  </span>
                  <p className="chat-anchor-body">{m.text}</p>
                </div>
              );
            }
            if (m.kind === "intent-marker") {
              return (
                <div key={i} className="chat-intent-marker">
                  asking about this…
                </div>
              );
            }
            return (
              <div
                key={i}
                className={m.role === "user" ? "chat-bubble chat-bubble-user" : "chat-bubble chat-bubble-coach pop-in"}
              >
                <p className="chat-bubble-text">
                  {m.cause === "backend-down" && coachNeedsSetup && coachStatus ? coachStatus.detail : m.text}
                </p>
                {m.cause === "backend-down" &&
                  (coachNeedsSetup ? (
                    <span className="chat-offline-chip">not set up</span>
                  ) : (
                    <span className="chat-offline-chip">offline</span>
                  ))}
                {/* Task 2 (2026-07-22, truthfulness leaks): a timeout is a
                    slow-but-healthy backend, not a down one -- reuses the
                    offline chip's exact styling (no new visual treatment,
                    no magenta) with different text, per the brief. */}
                {m.cause === "timeout" && <span className="chat-offline-chip">slow</span>}
                {/* B3a (2026-07-27, coach-truth-speed round): a validation
                    failure is neither offline nor slow -- the reply came
                    back, it just never came out clean. Same chip styling,
                    same discipline, own text. "templates-only" and
                    "off-topic" render no chip at all: a deliberate voice
                    pick isn't a failure, and nothing emits "off-topic" yet. */}
                {m.cause === "validation-failed" && <span className="chat-offline-chip">garbled</span>}
                {m.role === "coach" && m.traceId != null && <ThumbRating traceId={m.traceId} />}
              </div>
            );
          })}
          {/* B-stream / Task 1c (2026-08-02): the staged status bubble stays
              up until the first delta lands (streamDraft is still null at
              that point); once text starts streaming in, this swaps to the
              draft bubble below -- same mount point, never two bubbles at
              once. Its copy now tracks statusPhase (thinking/drafting/
              checking, real pipeline events, never prose) instead of a
              fixed "cookie is thinking…" string. Reuses the existing
              .chat-thinking class (not a new one) for the dimmed/italic
              draft treatment: skin/** already styles
              `.chat-thinking .chat-bubble-text` exactly that way. No
              thumbs, no chip on either bubble — those only ever attach to a
              settled ThreadEntry in `messages` above. */}
          {pending && streamDraft && (
            <div className="chat-bubble chat-bubble-coach chat-thinking pop-in">
              <p className="chat-bubble-text">{streamDraft.text}</p>
              {streamDraft.muted && <p className="chat-bubble-text">let me redo that</p>}
            </div>
          )}
          {pending && !streamDraft && (
            <div className="chat-bubble chat-bubble-coach chat-thinking pop-in">
              <p className="chat-bubble-text">{STATUS_PHASE_COPY[statusPhase ?? "thinking"]}</p>
            </div>
          )}
        </div>
        {coachStatus && coachStatus.state !== "ready" && (
          <p className="chat-setup-note" role="status">
            {coachStatus.detail}
          </p>
        )}
        <div className="chat-input-row">
          <input
            type="text"
            className="chat-input"
            value={draft}
            maxLength={CHAT_MAX_LEN}
            placeholder="ask cookie about the game…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
          />
          <button
            type="button"
            className="small chat-send-btn"
            onClick={send}
            disabled={pending || draft.trim().length === 0}
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}
