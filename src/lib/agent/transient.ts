/**
 * Whether a failed command failed because the network blinked.
 *
 * Found by building an APK through the app: Gradle died on
 * "Could not GET 'https://repo…'" while fetching a dependency, and the very
 * same command passed on the next run. Reporting that as a build failure — and
 * letting the anti-loop guard count it toward a ban — turns a hiccup into a
 * dead end. A download that did not finish is worth one more attempt.
 *
 * Deliberately narrow: a 404, a missing artifact or a bad credential is the
 * project's fault and would only fail the same way again.
 */

const NETWORK =
  /\b(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ECONNREFUSED|EPIPE)\b|socket hang up|(connection|read|connect)(ion)? (was )?(reset|timed out|refused)|temporary failure in name resolution|tls handshake timeout|network is unreachable|premature end of (content|file)|unexpected end of stream|\b(502|503|504)\b[^\n]{0,20}(bad gateway|service unavailable|gateway time-?out)|remote host terminated|unable to tunnel|failed to connect to/i;

/** Gradle/Maven saying a URL could not be fetched, without saying why. */
const ARTIFACT_FETCH = /could not (get|head|download)[^\n]{0,60}['"]https?:\/\//i;

/** The server answered, and the answer was no. Retrying cannot change it. */
const REFUSED = /status code (40\d|410)|\b40[134] (unauthorized|forbidden|not found)\b|authentication failed|could not find [a-z0-9_.-]+:[a-z0-9_.-]+/i;

export function looksTransient(output: string): boolean {
  if (!output) return false;
  if (REFUSED.test(output)) return false;
  return NETWORK.test(output) || ARTIFACT_FETCH.test(output);
}
