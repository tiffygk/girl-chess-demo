import { describe, it, expect } from "vitest";
import { listenErrorMessage, startupFailureMessage, openUrlMessage } from "./startupMessages";

describe("startup messages", () => {
  it("a busy port names the port and the two ways out", () => {
    const err = Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
    expect(listenErrorMessage(err, 3001)).toBe("port 3001 is already in use by another program. press Ctrl+C, then run PORT=3002 npm run dev, or quit that program and try again.");
  });
  it("other listen errors keep their own message after a plain lead-in", () => {
    const err = Object.assign(new Error("listen EACCES: permission denied 127.0.0.1:80"), { code: "EACCES" });
    expect(listenErrorMessage(err, 80)).toBe("girl chess could not open port 80: listen EACCES: permission denied 127.0.0.1:80");
  });
  it("a startup failure is one sentence with the reason", () => {
    expect(startupFailureMessage(new Error("opponent files for strength 1300 are missing. run ./setup.sh to download them."))).toBe(
      "girl chess could not start: opponent files for strength 1300 are missing. run ./setup.sh to download them."
    );
  });
  it("the open line follows VITE_PORT", () => {
    expect(openUrlMessage(undefined)).toBe("open http://localhost:5173 in your browser");
    expect(openUrlMessage("5373")).toBe("open http://localhost:5373 in your browser");
  });
});
