/**
 * Fetch an official FAQ page, falling back to its last-known-good snapshot
 *
 * The Commission's and ENISA's FAQ pages are fetched at build time. The site is
 * rebuilt every day to pick up their changes, so a build must survive an
 * outage or a structure change of either page: the raw body of every page
 * that was fetched and parsed successfully is written to a snapshot, and
 * when fetching or parsing the live page fails, the snapshot is parsed
 * instead. The fallback is reported as a warning (and as a GitHub Actions
 * annotation and job summary entry when building in CI) so that it doesn't
 * go unnoticed. Without a snapshot the error propagates and the build fails,
 * so that a broken site is never deployed.
 *
 * The snapshot directory is not committed. In CI it is kept between runs with
 * the GitHub Actions cache (see .github/workflows/deploy.yml).
 *
 * Setting OFFICIAL_FAQ_FETCH=strict disables the fallback.
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_DIR = path.join(__dirname, "..", "..", "..", "_snapshots");
const FETCH_TIMEOUT_MS = 30_000;

/**
 * Fetch a page and parse it, or parse its snapshot when that fails
 *
 * @param {Object} options
 * @param {string} options.name - Human-readable name of the page, for messages
 * @param {string} options.url - URL to fetch
 * @param {string} options.snapshotFile - Snapshot file name
 * @param {(body: string) => any} options.parse - Parses the body of the page
 *   (live or snapshot); must throw when the structure isn't the expected one
 * @param {string} [options.snapshotDir] - Where snapshots are stored
 * @param {boolean} [options.strict] - Disable the fallback
 * @param {number} [options.timeoutMs] - Time allowed for the fetch
 * @param {Object} [options.env] - Environment variables (for CI reporting)
 * @param {Object} [options.log] - Logger with a warn() method
 * @returns {Promise<{ data: any, source: "live" | "snapshot", snapshotDate?: Date, error?: Error }>}
 */
async function fetchWithFallback({
  name,
  url,
  snapshotFile,
  parse,
  snapshotDir = SNAPSHOT_DIR,
  strict = process.env.OFFICIAL_FAQ_FETCH === "strict",
  timeoutMs = FETCH_TIMEOUT_MS,
  env = process.env,
  log = console
}) {
  const snapshotPath = path.join(snapshotDir, snapshotFile);

  let liveError;
  try {
    const body = await fetchBody(url, timeoutMs);
    const data = parse(body);
    writeSnapshot(snapshotPath, body);
    return { data, source: "live" };
  } catch (error) {
    liveError = error;
  }

  if (strict) {
    throw wrapError(`Failed to fetch ${name} from ${url} (strict mode, no fallback)`, liveError);
  }

  if (!fs.existsSync(snapshotPath)) {
    throw wrapError(`Failed to fetch ${name} from ${url} and no snapshot is available at ${snapshotPath}`, liveError);
  }

  const snapshotDate = fs.statSync(snapshotPath).mtime;
  let data;
  try {
    data = parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch (snapshotError) {
    throw wrapError(`Failed to fetch ${name} from ${url} (${liveError.message}), and its snapshot at ${snapshotPath} cannot be parsed either`, snapshotError);
  }

  reportFallback({ name, url, snapshotDate, error: liveError, env, log });
  return { data, source: "snapshot", snapshotDate, error: liveError };
}

async function fetchBody(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response.text();
}

// Write the snapshot atomically so that a crash mid-write can't leave a
// truncated snapshot behind
function writeSnapshot(snapshotPath, body) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const tmpPath = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, body);
  fs.renameSync(tmpPath, snapshotPath);
}

function wrapError(message, cause) {
  return new Error(`${message}: ${cause.message}`, { cause });
}

// Warn on the console and, in GitHub Actions, as a workflow annotation and
// a job summary entry
function reportFallback({ name, url, snapshotDate, error, env, log }) {
  const date = snapshotDate.toISOString();
  const message = `${name} could not be fetched from ${url} (${error.message}). Using the snapshot from ${date} instead.`;

  log.warn(`⚠️  ${message}`);

  if (env.GITHUB_ACTIONS === "true") {
    log.warn(`::warning title=${name} built from snapshot::${message}`);
  }

  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `> [!WARNING]\n> ${message}\n\n`);
  }
}

module.exports = { fetchWithFallback, SNAPSHOT_DIR, FETCH_TIMEOUT_MS };
