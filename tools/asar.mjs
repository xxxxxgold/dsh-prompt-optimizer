/**
 * Minimal Electron ASAR reader — enough to list, grep, and extract files from
 * the DSH checkout without network access or extra dependencies.
 *
 *   node tools/asar.mjs ls <substring>
 *   node tools/asar.mjs cat <exact inner path> [outFile]
 *   node tools/asar.mjs grep <regex> [substring-filter]
 *
 * Inner paths use forward slashes and no leading slash, e.g.
 *   dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/dist/index.js
 *
 * The asar location is resolved in this order:
 *   1. `DSH_ASAR` environment variable (explicit wins, but must point at a file)
 *   2. a bounded list of well-known install locations (see `candidatePaths`)
 *
 * Nothing scans the disk: an install somewhere unusual is a config, not a search
 * problem, so the tool prints the candidates and tells you to set `DSH_ASAR`.
 */
import { readFileSync, realpathSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Sub-path of the asar inside one DSH install root. */
const ASAR_SUBPATH = 'DeepSeek Harness/resources/app.asar';

/** True only for an existing regular file (a directory named `app.asar` is not an asar). */
function defaultIsFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Build the bounded candidate list for one environment.
 *
 * @param env - an environment object (usually `process.env`).
 * @param platform - `process.platform` value, injectable for tests.
 * @returns candidate paths, de-duplicated, in probe order.
 */
export function candidatePaths(env, platform = process.platform) {
  const roots = [];
  const push = (value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed !== '') roots.push(trimmed);
  };

  if (platform === 'win32') {
    // The platform-provided roots first: they are right on the machine that set them.
    push(env.ProgramFiles);
    push(env['ProgramFiles(x86)']);
    if (typeof env.LOCALAPPDATA === 'string') push(env.LOCALAPPDATA.replace(/\\/g, '/') + '/Programs');
    // A user-installed DSH often lands on a non-system drive, which no env var names.
    for (const drive of ['C:', 'D:', 'E:']) {
      push(drive + '/Program Files');
      push(drive + '/Program Files (x86)');
    }
  }

  const list = roots.map((root) => root.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + ASAR_SUBPATH);
  // Non-Windows layouts: a .app bundle and a plain install tree.
  list.push('/Applications/DeepSeek Harness.app/Contents/Resources/app.asar');
  list.push('/opt/' + ASAR_SUBPATH);
  return [...new Set(list)];
}

/**
 * Resolve which asar to read.
 *
 * @param env - environment object, defaults to `process.env`.
 * @param isFile - regular-file probe, injectable for tests.
 * @param platform - `process.platform` value, injectable for tests.
 * @returns `{ path, source }` on success; `{ path: null, source, candidates }` when nothing is usable.
 */
export function resolveAsarPath(env = process.env, isFile = defaultIsFile, platform = process.platform) {
  const candidates = candidatePaths(env, platform);
  const explicit = env.DSH_ASAR;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const trimmed = explicit.trim();
    if (isFile(trimmed)) return { path: trimmed, source: 'env' };
    // An explicit override that does not exist is a typo, not a search problem.
    return { path: null, source: 'env-missing', explicit: trimmed, candidates };
  }
  for (const candidate of candidates) {
    if (isFile(candidate)) return { path: candidate, source: 'probe' };
  }
  return { path: null, source: 'missing', candidates };
}

/**
 * Human-readable explanation for a failed resolution.
 *
 * Exported so the offline self-test can assert on the text without spawning a
 * process or capturing stderr.
 *
 * @param resolved - the failure object from {@link resolveAsarPath}.
 * @returns lines to print on stderr.
 */
export function describeResolutionFailure(resolved) {
  if (resolved.source === 'env-missing') {
    return [
      'DSH_ASAR 指向的文件不存在或不是文件：' + resolved.explicit,
      '请检查路径，或取消 DSH_ASAR 让工具自动探测。',
    ];
  }
  const lines = ['找不到 DeepSeek Harness 的 app.asar。已探测这些位置：'];
  for (const candidate of resolved.candidates) lines.push('  ' + candidate);
  lines.push('');
  lines.push('如果 DSH 装在别处，用环境变量指定（两种写法选一种）：');
  lines.push('  PowerShell: $env:DSH_ASAR = "D:/path/to/DeepSeek Harness/resources/app.asar"; node tools/asar.mjs ls <substr>');
  lines.push('  POSIX:      DSH_ASAR="/path/to/DeepSeek Harness/resources/app.asar" node tools/asar.mjs ls <substr>');
  return lines;
}

/** Read one asar into `{ buf, baseOffset, files }`. */
export function loadAsar(asarPath) {
  const buf = readFileSync(asarPath);
  const pickleSize = buf.readUInt32LE(4);
  const jsonSize = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString('utf8'));
  const baseOffset = 8 + pickleSize;
  const files = new Map(); // inner path -> {offset, size}
  (function walk(node, prefix) {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const path = prefix === '' ? name : prefix + '/' + name;
      if (entry.files) walk(entry, path);
      else if (entry.size !== undefined) files.set(path, { offset: Number(entry.offset), size: entry.size });
    }
  })(header, '');
  return { buf, baseOffset, files };
}

/**
 * Run one CLI command against a loaded asar.
 *
 * @param argv - `[cmd, arg, extra]`.
 * @param asarPath - the asar file to read.
 * @param io - `{ out, err, write }` sinks, injectable for tests.
 * @returns the process exit code.
 */
export function run(argv, asarPath, io = { out: console.log, err: console.error, write: (text) => process.stdout.write(text) }) {
  const { buf, baseOffset, files } = loadAsar(asarPath);
  const [cmd, arg, extra] = argv;

  function readEntry(path) {
    const entry = files.get(path);
    if (entry === undefined) throw new Error('not in asar: ' + path);
    return buf.subarray(baseOffset + entry.offset, baseOffset + entry.offset + entry.size);
  }

  if (cmd === 'ls') {
    const needle = arg || '';
    let count = 0;
    for (const path of files.keys()) {
      if (path.includes(needle)) {
        io.out(path);
        count += 1;
      }
    }
    io.err('total files: ' + files.size + ', matched: ' + count);
    return 0;
  }
  if (cmd === 'cat') {
    const text = readEntry(arg).toString('utf8');
    if (extra) {
      mkdirSync(dirname(extra), { recursive: true });
      writeFileSync(extra, text);
      io.err('wrote ' + text.length + ' chars to ' + extra);
    } else {
      io.write(text);
    }
    return 0;
  }
  if (cmd === 'grep') {
    const re = new RegExp(arg, 'g');
    const filter = extra || '';
    let hits = 0;
    for (const path of files.keys()) {
      if (filter !== '' && !path.includes(filter)) continue;
      if (!/\.(js|mjs|cjs|ts|json|md|yml|yaml)$/.test(path)) continue;
      const text = readEntry(path).toString('utf8');
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null && hits < 400) {
        const line = text.slice(Math.max(0, match.index - 220), match.index + 320).replace(/\n/g, '\\n');
        io.out('--- ' + path + ' @' + match.index + '\n' + line + '\n');
        hits += 1;
      }
      re.lastIndex = 0;
    }
    io.err('hits: ' + hits);
    return 0;
  }
  io.err('usage: ls <substr> | cat <path> [outFile] | grep <regex> [pathFilter]');
  return 2;
}

/** Command-line entry. */
function main(argv) {
  const resolved = resolveAsarPath();
  if (resolved.path === null) {
    for (const line of describeResolutionFailure(resolved)) console.error(line);
    process.exitCode = 1;
    return;
  }
  // Only announce the path when the caller asked for it explicitly: probing is
  // the normal case and should stay quiet, like the pre-rewrite tool.
  if (resolved.source === 'env') console.error('asar: ' + resolved.path + ' (DSH_ASAR)');

  process.exitCode = run(argv, resolved.path);
}

/**
 * True when this module is the script Node was asked to run.
 *
 * The lexical comparison is not enough: Node resolves the entry module to its
 * real path, while `process.argv[1]` keeps the path the shell used, so invoking
 * through a junction or symlink would compare two different strings and the CLI
 * would silently do nothing. Compare real paths first, then fall back to the
 * lexical form when either path cannot be resolved.
 *
 * @returns whether {@link main} should run.
 */
export function isDirectInvocation() {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry === '') return false;
  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry)) return true;
  } catch {
    // Fall through: a deleted/renamed path still deserves the lexical check.
  }
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) main(process.argv.slice(2));
