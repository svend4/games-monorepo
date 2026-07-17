import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  browserExecutableCandidates,
  browserShutdownMode,
  resolveStaticPath,
} from "../scripts/run-browser-smoke.mjs";

test("smoke server paths stay inside the repository root", () => {
  const root = path.resolve("example-root");

  assert.equal(resolveStaticPath(root, "/"), path.join(root, "index.html"));
  assert.equal(
    resolveStaticPath(root, "/apps/safe-search/"),
    path.join(root, "apps", "safe-search", "index.html"),
  );
  assert.equal(resolveStaticPath(root, "/../outside.txt"), null);
  assert.equal(resolveStaticPath(root, "/%2e%2e/outside.txt"), null);
  assert.equal(resolveStaticPath(root, "/%E0%A4%A"), null);
});

test("browser detection prefers an explicit executable and removes duplicates", () => {
  const candidates = browserExecutableCandidates({
    CHROME_BIN: "C:\\Browsers\\chrome.exe",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\Test\\AppData\\Local",
  }, "win32");

  assert.equal(candidates[0], "C:\\Browsers\\chrome.exe");
  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.some((candidate) =>
    candidate.endsWith("Google\\Chrome\\Application\\chrome.exe")));
  assert.ok(candidates.some((candidate) =>
    candidate.endsWith("Microsoft\\Edge\\Application\\msedge.exe")));
});

test("Windows closes the complete isolated browser process tree", () => {
  assert.equal(browserShutdownMode("win32"), "process-tree");
  assert.equal(browserShutdownMode("darwin"), "graceful");
  assert.equal(browserShutdownMode("linux"), "graceful");
});
