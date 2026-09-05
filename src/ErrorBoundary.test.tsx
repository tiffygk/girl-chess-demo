import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary, ErrorFallback } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("flips its state to failed when a child throws during render", () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it("renders children normally when nothing has failed", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>
    );
    expect(html).toContain("all good");
  });

  it("the fallback says what happened and offers a reload button", () => {
    const html = renderToStaticMarkup(<ErrorFallback />);
    expect(html).toContain("something went wrong on this page.");
    expect(html).toContain("reload the page to keep playing.");
    expect(html).not.toContain("Terminal");
    expect(html).toContain(">reload<");
    expect(html).not.toContain("\u2014");
  });

  // Review round 2 (minor finding): a rendering bug is otherwise invisible
  // past the fallback sentence -- componentDidCatch is React's own hook for
  // getting the error and its component stack somewhere a developer can see
  // it (the browser console), without changing what the fallback shows.
  it("logs the caught error and its component stack to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boundary = new ErrorBoundary({ children: null });
    const error = new Error("boom");
    const info = { componentStack: "\n    at Broken\n    at ErrorBoundary" };

    boundary.componentDidCatch(error, info);

    expect(spy).toHaveBeenCalledWith(error, info.componentStack);
    spy.mockRestore();
  });
});
