const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fetchWithFallback } = require("../src/_data/utils/fetch-with-fallback.js");

const URL = "https://example.europa.eu/faq";
const originalFetch = globalThis.fetch;

let snapshotDir, warnings, log;

// Stub the global fetch with a function returning a Response, or throwing
function stubFetch(handler) {
  globalThis.fetch = async (url, options) => handler(url, options);
}

function options(overrides = {}) {
  return {
    name: "Example FAQ",
    url: URL,
    snapshotFile: "example.html",
    parse: (body) => ({ body }),
    snapshotDir,
    strict: false,
    env: {},
    log,
    ...overrides
  };
}

function snapshotPath() {
  return path.join(snapshotDir, "example.html");
}

beforeEach(() => {
  snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "faq-snapshots-"));
  warnings = [];
  log = { warn: (message) => warnings.push(message) };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fs.rmSync(snapshotDir, { recursive: true, force: true });
});

describe("live page", () => {
  test("parses the live page and writes its snapshot", async () => {
    stubFetch(() => new Response("<p>live</p>"));

    const result = await fetchWithFallback(options());

    assert.deepEqual(result, { data: { body: "<p>live</p>" }, source: "live" });
    assert.equal(fs.readFileSync(snapshotPath(), "utf8"), "<p>live</p>");
    assert.deepEqual(warnings, []);
  });

  test("passes a timeout signal to fetch", async () => {
    let signal;
    stubFetch((url, opts) => { signal = opts.signal; return new Response("ok"); });

    await fetchWithFallback(options({ timeoutMs: 1234 }));

    assert.ok(signal instanceof AbortSignal);
  });

  test("overwrites a previous snapshot", async () => {
    fs.writeFileSync(snapshotPath(), "old");
    stubFetch(() => new Response("new"));

    await fetchWithFallback(options());

    assert.equal(fs.readFileSync(snapshotPath(), "utf8"), "new");
  });

  test("leaves the snapshot untouched when the live page doesn't parse", async () => {
    fs.writeFileSync(snapshotPath(), "old");
    stubFetch(() => new Response("garbage"));
    const parse = (body) => { if (body === "garbage") throw new Error("unexpected structure"); return { body }; };

    const result = await fetchWithFallback(options({ parse }));

    assert.equal(result.source, "snapshot");
    assert.equal(fs.readFileSync(snapshotPath(), "utf8"), "old");
  });
});

describe("fallback to the snapshot", () => {
  test("uses the snapshot when the fetch fails", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => { throw new Error("ECONNRESET"); });

    const result = await fetchWithFallback(options());

    assert.equal(result.source, "snapshot");
    assert.deepEqual(result.data, { body: "snap" });
    assert.ok(result.snapshotDate instanceof Date);
    assert.equal(result.error.message, "ECONNRESET");
  });

  test("uses the snapshot on an HTTP error", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => new Response("Service unavailable", { status: 503 }));

    const result = await fetchWithFallback(options());

    assert.equal(result.source, "snapshot");
    assert.equal(result.error.message, "HTTP error! status: 503");
  });

  test("warns on the console", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => { throw new Error("ECONNRESET"); });

    await fetchWithFallback(options());

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Example FAQ could not be fetched from https:\/\/example\.europa\.eu\/faq \(ECONNRESET\)\. Using the snapshot from \d{4}-\d{2}-\d{2}T[\d:.]+Z instead\./);
  });

  test("reports the fallback to GitHub Actions", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => { throw new Error("ECONNRESET"); });
    const summaryPath = path.join(snapshotDir, "summary.md");
    const env = { GITHUB_ACTIONS: "true", GITHUB_STEP_SUMMARY: summaryPath };

    await fetchWithFallback(options({ env }));

    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /^::warning title=Example FAQ built from snapshot::Example FAQ could not be fetched/);
    assert.match(fs.readFileSync(summaryPath, "utf8"), /^> \[!WARNING\]\n> Example FAQ could not be fetched/);
  });

  test("fails when there is no snapshot", async () => {
    stubFetch(() => { throw new Error("ECONNRESET"); });

    await assert.rejects(
      fetchWithFallback(options()),
      { message: `Failed to fetch Example FAQ from ${URL} and no snapshot is available at ${snapshotPath()}: ECONNRESET` }
    );
  });

  test("fails when the snapshot doesn't parse either", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => { throw new Error("ECONNRESET"); });
    const parse = () => { throw new Error("unexpected structure"); };

    await assert.rejects(
      fetchWithFallback(options({ parse })),
      { message: `Failed to fetch Example FAQ from ${URL} (ECONNRESET), and its snapshot at ${snapshotPath()} cannot be parsed either: unexpected structure` }
    );
  });

  test("fails without falling back in strict mode", async () => {
    fs.writeFileSync(snapshotPath(), "snap");
    stubFetch(() => { throw new Error("ECONNRESET"); });

    await assert.rejects(
      fetchWithFallback(options({ strict: true })),
      { message: `Failed to fetch Example FAQ from ${URL} (strict mode, no fallback): ECONNRESET` }
    );
    assert.deepEqual(warnings, []);
  });
});
