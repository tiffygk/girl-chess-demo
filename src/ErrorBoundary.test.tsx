import { describe, it, expect } from "vitest";
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
    expect(html).toContain(
      "reload the page to keep playing. if it happens again, the Terminal window shows the error to report."
    );
    expect(html).toContain(">reload<");
    expect(html).not.toContain("\u2014");
  });
});
