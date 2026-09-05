import { Component, type ErrorInfo, type ReactNode } from "react";

// The last line of defence: a rendering bug shows one sentence and a reload
// button instead of a blank page. Exported separately from ErrorBoundary so
// its markup can be pinned by a static render without needing to actually
// throw through a React error boundary (renderToStaticMarkup does not run
// error boundaries).
export function ErrorFallback() {
  return (
    <div className="server-down" role="alert">
      <p>something went wrong on this page.</p>
      <p>reload the page to keep playing.</p>
      <button type="button" className="small" onClick={() => window.location.reload()}>reload</button>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  // Review round 2 (minor finding): the fallback sentence tells the player
  // to reload; this is what tells a developer anything at all -- otherwise
  // the caught error and its component stack vanish the moment the fallback
  // renders. Console only, no change to what the fallback shows.
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <ErrorFallback />;
  }
}
