export const DEFAULT_MAX_FILE_SIZE_BYTES = 1_048_576;
export const DEFAULT_MAX_DIFF_BYTES = 204_800;

export interface CodeCaptureLimits {
  maxFileSizeBytes: number;
  maxDiffBytes: number;
  exclude: string[];
}

export interface CodeDiff {
  patch: string;
  beforeStartLine: number;
  beforeLineCount: number;
  afterStartLine: number;
  afterLineCount: number;
  addedLines: number;
  removedLines: number;
  originalPatchBytes: number;
  retainedPatchBytes: number;
  patchTruncated: boolean;
}

export type CaptureEligibility = { eligible: true } | { eligible: false; reason: string };

const ignoredDirectories = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '.venv', 'venv', '__pycache__']);
const binarySuffix = /\.(?:png|jpe?g|gif|webp|ico|zip|gz|tar|7z|exe|dll|so|dylib|pdf|class|jar|woff2?|ttf|eot|mp3|mp4|mov|avi|db|sqlite)$/i;
const sensitiveName = /^(?:\.env(?:\..+)?|id_rsa(?:\..+)?|id_ed25519(?:\..+)?|credentials.*|secrets.*|.*secret.*|\.npmrc|\.pypirc|\.netrc|docker-config\.json)$/i;
const sensitiveSuffix = /\.(?:pem|key|pfx|p12|keystore|jks)$/i;
const lockName = /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|composer\.lock)$/i;
const generatedName = /(?:\.generated|\.g|\.gen)\.[^/]+$|(?:^|\/)(?:generated|__generated__)(?:\/|$)/i;

export function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '');
}

function globMatches(path: string, pattern: string): boolean {
  const normalizedPattern = normalizedPath(pattern.trim());
  if (!normalizedPattern) return false;
  let source = '';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index];
    if (character === '*') {
      if (normalizedPattern[index + 1] === '*') {
        index += 1;
        if (normalizedPattern[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else source += '.*';
      } else source += '[^/]*';
    } else if (character === '?') source += '[^/]';
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  const matcher = new RegExp(`^${source}$`, 'i');
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return matcher.test(path) || (!normalizedPattern.includes('/') && matcher.test(basename));
}

export function captureEligibility(filePath: string, text: string, limits: CodeCaptureLimits): CaptureEligibility {
  const normalized = normalizedPath(filePath);
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  const segments = normalized.toLowerCase().split('/');
  if (!normalized || segments.some(segment => ignoredDirectories.has(segment))) return { eligible: false, reason: 'ignored_path' };
  if (sensitiveName.test(basename) || sensitiveSuffix.test(basename)) return { eligible: false, reason: 'sensitive_file' };
  if (binarySuffix.test(basename) || text.includes('\u0000')) return { eligible: false, reason: 'binary_file' };
  if (lockName.test(normalized)) return { eligible: false, reason: 'lock_file' };
  if (generatedName.test(normalized)) return { eligible: false, reason: 'generated_file' };
  if (limits.exclude.some(pattern => globMatches(normalized, pattern))) return { eligible: false, reason: 'configured_exclusion' };
  if (Buffer.byteLength(text, 'utf8') > limits.maxFileSizeBytes) return { eligible: false, reason: 'file_size_limit' };
  if (text.split(/\r?\n/).some(line => line.length > 2_000)) return { eligible: false, reason: 'likely_minified' };
  return { eligible: true };
}

function normalizedLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized ? normalized.split('\n') : [];
}

function cappedText(value: string, byteLimit: number): string {
  if (byteLimit <= 0 || !value) return '';
  if (Buffer.byteLength(value, 'utf8') <= byteLimit) return value;
  let start = 0;
  let end = value.length;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= byteLimit) start = middle;
    else end = middle - 1;
  }
  return value.slice(0, start);
}

function prefixed(lines: string[], prefix: '-' | '+'): string {
  return lines.map(line => `${prefix}${line}`).join('\n');
}

function truncatePatch(header: string, removed: string[], added: string[], maxBytes: number): string {
  const marker = '<diff-truncated>';
  const fixed = `${header}\n`;
  // Reserve all join separators as well as the marker.  This keeps the final
  // UTF-8 payload within the advertised cap even for a very small test limit.
  const available = Math.max(0, maxBytes - Buffer.byteLength(header, 'utf8') - Buffer.byteLength(marker, 'utf8') - 3);
  const removedText = cappedText(prefixed(removed, '-'), Math.floor(available / 2));
  const addedText = cappedText(prefixed(added, '+'), Math.max(0, available - Buffer.byteLength(removedText, 'utf8')));
  return [fixed.trimEnd(), removedText, addedText, marker].filter(Boolean).join('\n');
}

/** Build a deterministic, line-oriented save-time patch without requiring Git. */
export function createSaveDiff(before: string, after: string, filePath: string, maxBytes: number): CodeDiff | undefined {
  if (before === after) return undefined;
  const previous = normalizedLines(before);
  const current = normalizedLines(after);
  let prefix = 0;
  while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < current.length - prefix && previous[previous.length - suffix - 1] === current[current.length - suffix - 1]) suffix += 1;
  const removed = previous.slice(prefix, previous.length - suffix);
  const added = current.slice(prefix, current.length - suffix);
  const safePath = normalizedPath(filePath) || 'untitled';
  const header = `--- a/${safePath}\n+++ b/${safePath}\n@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`;
  const complete = [header, prefixed(removed, '-'), prefixed(added, '+')].filter(Boolean).join('\n');
  const originalPatchBytes = Buffer.byteLength(complete, 'utf8');
  const retained = originalPatchBytes > maxBytes ? truncatePatch(header, removed, added, maxBytes) : complete;
  return {
    patch: retained,
    beforeStartLine: prefix + 1,
    beforeLineCount: removed.length,
    afterStartLine: prefix + 1,
    afterLineCount: added.length,
    addedLines: added.length,
    removedLines: removed.length,
    originalPatchBytes,
    retainedPatchBytes: Buffer.byteLength(retained, 'utf8'),
    patchTruncated: retained !== complete,
  };
}
