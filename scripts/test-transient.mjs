/** node --experimental-strip-types --test scripts/test-transient.mjs */
import assert from 'node:assert/strict';
import test from 'node:test';
import { looksTransient } from '../src/lib/agent/transient.ts';

test('the Gradle dependency fetch that actually failed is transient', () => {
  const out = `Execution failed for task ':app:checkDebugAarMetadata'.
> Could not resolve all files for configuration ':app:debugRuntimeClasspath'.
   > Could not resolve org.jetbrains.kotlin:kotlin-stdlib:2.1.0.
     Required by:
         project :app > androidx.appcompat:appcompat:1.7.0
      > Could not resolve org.jetbrains.kotlin:kotlin-stdlib:2.1.0.
         > Could not get resource 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.pom'.
            > Could not GET 'https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.pom'.`;
  assert.equal(looksTransient(out), true);
});

test('classic network errors from npm, pip, curl and git are transient', () => {
  for (const out of [
    'npm ERR! code ECONNRESET\nnpm ERR! network request failed',
    'ReadTimeoutError: HTTPSConnectionPool: Read timed out.',
    'curl: (7) Failed to connect to registry.example.com port 443',
    'fatal: unable to access: Could not resolve host\nTemporary failure in name resolution',
    'error: RPC failed; curl 56 OpenSSL SSL_read: Connection reset by peer',
    'HTTP 503 Service Unavailable',
    'npm ERR! code ETIMEDOUT',
    'socket hang up',
  ]) {
    assert.equal(looksTransient(out), true, out);
  }
});

test('a server saying no is the project\'s fault and is not retried', () => {
  for (const out of [
    "Could not GET 'https://repo.maven.apache.org/maven2/x/y/1/y-1.pom'. Received status code 404 from server: Not Found",
    'Could not find com.example:missing-lib:1.0.',
    'HTTP 401 Unauthorized',
    "Could not GET 'https://maven.pkg.github.com/x'. Received status code 403 from server: Forbidden",
    'authentication failed for https://github.com/x/y.git',
  ]) {
    assert.equal(looksTransient(out), false, out);
  }
});

test('an ordinary compile or test failure is not transient', () => {
  for (const out of [
    "e: MainActivity.kt: (14, 9): Unresolved reference: foo",
    'AssertionError: expected 3 to equal 4',
    'error TS2304: Cannot find name "x".',
    "ls: cannot access '/definitely/not/here': No such file or directory",
    '',
  ]) {
    assert.equal(looksTransient(out), false, out);
  }
});
