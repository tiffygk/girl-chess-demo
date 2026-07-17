export type ReconcileAction = "ok" | "adopt";

export interface ReconcileResult {
  action: ReconcileAction;
}

/**
 * Compares the client's local mirror fen against the server's authoritative
 * fen after a successful move reply. Any mismatch (including an empty/
 * missing server fen) means the client must adopt the server's state.
 */
export function reconcile(mirrorFen: string, serverFen: string): ReconcileResult {
  return mirrorFen === serverFen ? { action: "ok" } : { action: "adopt" };
}
