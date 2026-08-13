/* Downloads one pinned VS Code test runtime in an owned child process.
 * Keeping this work out of the E2E launcher lets the parent enforce a hard
 * timeout and clean up a stuck network transfer without touching unrelated
 * processes. */
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

async function main() {
  const version = process.argv[2];
  if (!version) throw new Error('VS Code version argument is required');
  const executable = await downloadAndUnzipVSCode(version);
  process.stdout.write(`${JSON.stringify({ executable })}\n`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
