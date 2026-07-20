import { useEffect, useRef, useState } from "react";
import { chatWithCoach, rateTrace, type ChatContext } from "./api";

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

interface ChatBubble {
  role: "user" | "coach";
  text: string;
  cause?: "backend-down";
  // Task 4 (F19): every coach reply has a trace -- model, template, AND
  // backend-down redirect all write one (Task 2's scope). Undefined only in
  // the truly defensive case where the server's envelope omitted it.
  traceId?: number;
}

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
}

export function CoachChat({ gameId, mode, buildContext, hidden }: CoachChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestTokenRef = useRef(0);

  // "component chat state resets when the viewed game id changes (server
  // owns durable history)" — the visible thread is per-view only; switching
  // games (new live game, or picking a different past game to review)
  // starts a fresh blank thread rather than carrying the old one over.
  useEffect(() => {
    requestTokenRef.current += 1; // drop any in-flight reply from the old game
    setMessages([]);
    setDraft("");
    setPending(false);
    setOpen(false);
  }, [gameId]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, pending, open]);

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
    setMessages((prev) => [...prev, { role: "user", text }]);
    setDraft("");
    chatWithCoach(gameId, { message: text, context: buildContext() })
      .then((res) => {
        if (requestTokenRef.current !== token) return; // superseded — drop it
        // Minor fix (task-reviewer): `res.text != null` rather than
        // truthiness — an empty-string reply is a real (if odd) reply, not
        // a failure, and shouldn't fall through to the fallback copy.
        if (res.ok && res.text != null) {
          setMessages((prev) => [...prev, { role: "coach", text: res.text!, cause: res.cause, traceId: res.traceId }]);
        } else {
          setMessages((prev) => [...prev, { role: "coach", text: FALLBACK_TEXT }]);
        }
      })
      .catch(() => {
        if (requestTokenRef.current !== token) return;
        setMessages((prev) => [...prev, { role: "coach", text: FALLBACK_TEXT }]);
      })
      .finally(() => {
        if (requestTokenRef.current !== token) return;
        setPending(false);
      });
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    send();
  };

  // Visibility only — never touches state. Hiding (a debrief rewind, or the
  // end-game takedown cinematic) must leave messages/draft/open exactly as
  // they were so un-hiding picks the conversation back up.
  if (hidden) return null;

  if (!open) {
    return (
      <button type="button" className="small chat-opener-btn" onClick={() => setOpen(true)}>
        chat with the coach
      </button>
    );
  }

  const emptyCopy = mode === "review" ? "ask about this game." : "ask about the position on the board.";

  return (
    <div className="chat-overlay" role="dialog" aria-label="coach chat">
      <div className="chat-drawer pop-in">
        <div className="chat-drawer-head">
          <span className="chat-kicker">coach chat</span>
          <button type="button" className="small" onClick={() => setOpen(false)}>
            close
          </button>
        </div>
        <div className="chat-messages" ref={listRef}>
          {messages.length === 0 && <p className="chat-empty">{emptyCopy}</p>}
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "chat-bubble chat-bubble-user" : "chat-bubble chat-bubble-coach pop-in"}
            >
              <p className="chat-bubble-text">{m.text}</p>
              {m.cause === "backend-down" && <span className="chat-offline-chip">offline</span>}
              {m.role === "coach" && m.traceId != null && <ThumbRating traceId={m.traceId} />}
            </div>
          ))}
          {pending && (
            <div className="chat-bubble chat-bubble-coach chat-thinking pop-in">
              <p className="chat-bubble-text">coach is thinking...</p>
            </div>
          )}
        </div>
        <div className="chat-input-row">
          <input
            type="text"
            className="chat-input"
            value={draft}
            maxLength={CHAT_MAX_LEN}
            placeholder="ask the coach..."
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
