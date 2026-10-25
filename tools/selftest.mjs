/**
 * dsh-prompt-optimizer — offline self-test.
 *
 * Runs both halves the way the real runtimes do, with no browser, no CLI, and
 * no network:
 *
 *   - host half: imported directly and mounted against a fake Cordis context
 *     whose `webServer` captures the route handler; the handler is then exercised
 *     with fake `req`/`res` objects over a fake streaming `llm`.
 *   - client half: evaluated in a `node:vm` sandbox with a fake
 *     `window.__ModuleLoader__`, a fake `react`, and a fake `react/jsx-runtime`;
 *     the captured factory is invoked and its plugin mounted against a fake
 *     client context whose `slots`/`locale` capture the registration.
 *
 *   node tools/selftest.mjs
 *
 * Exits non-zero on any failed check.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  ok   ' + name);
  } else {
    failed += 1;
    console.error('  FAIL ' + name + (detail === undefined ? '' : ' — ' + detail));
  }
}

function section(title) {
  console.log('\n== ' + title + ' ==');
}

// ---------------------------------------------------------------------------
// Host half
// ---------------------------------------------------------------------------
section('host half');

const host = await import('../index.js');
const H = host.__internals;

/** A well-formed hardened answer: opener, ≥2 bullets, self-check, closer. */
const HARDENED = [
  '哥们，直接给我整一个成品，gogogo！',
  '- 写一个网页：原样兑现，一个字不许改。',
  '- 细节拉满，别留占位符和 TODO。',
  '- 能并行就并行，越快越好。',
  '交活儿前自己按上面的硬指标逐条核对一遍，gogogo！',
].join('\n');

/** A well-formed Trellis issue card (six+ lines, sections intact). */
const CARD = [
  '## 任务：周报页白屏',
  'workType: issue ｜ slug 建议：issue-10-25-weekly-blank',
  '## 现象',
  '点周报就白屏。',
  '## 复现步骤',
  '1. 打开周报页。',
  '## 期望 vs 实际',
  '期望看到报表，实际白屏。',
  '## 影响范围',
  '全部用户。',
  '## 证据',
  '控制台报错。',
  '## 根因候选（最多 3 条，按可能性排序）',
  '1. 空数据没兜底。',
  '## 修复方案',
  '补空态。',
  '## 回归验证',
  '手点一遍。',
].join('\n');

check('module exports name', host.name === 'dsh-prompt-optimizer', String(host.name));
check('module injects webServer', Array.isArray(host.inject) && host.inject.includes('webServer'), JSON.stringify(host.inject));

// --- pure helpers ----------------------------------------------------------
const system = H.buildSystemPrompt('hard', '');
check('system prompt states the iron rules', /信息不许丢/.test(system) && /不许新增原文没有的具体事实/.test(system));
check('system prompt carries both style samples', /老哥们，是这样的/.test(system) && /哥们时间紧任务重/.test(system));
check('system prompt forbids code fences', /不要 Markdown 代码块围栏/.test(system));
check('style hint is appended when supplied', /【本部署追加的口气要求】\n说话再糙一点/.test(H.buildSystemPrompt('hard', '说话再糙一点')));
check('unknown style falls back to hard', H.buildSystemPrompt('nonsense', '') === H.buildSystemPrompt('hard', ''));
check('team flavour is selectable', /肌肉集团总动员/.test(H.buildSystemPrompt('team', '')));

// --- Trellis presets -------------------------------------------------------
const nativeSystem = H.buildSystemPrompt('hard', '', 'native');
check('native preset adds no task card', !/Trellis/.test(nativeSystem), 'native');
check(
  'feat preset demands the feature card',
  /workType: feat/.test(H.buildSystemPrompt('hard', '', 'feat')) &&
    /## 验收标准/.test(H.buildSystemPrompt('hard', '', 'feat')) &&
    /feat-<MM-DD>/.test(H.buildSystemPrompt('hard', '', 'feat')),
);
check(
  'issue preset demands the bug card',
  /workType: issue/.test(H.buildSystemPrompt('hard', '', 'issue')) && /## 复现步骤/.test(H.buildSystemPrompt('hard', '', 'issue')),
);
check(
  'refactor preset demands the refactor card',
  /workType: refactor/.test(H.buildSystemPrompt('cool', '', 'refactor')) && /## 行为不变契约/.test(H.buildSystemPrompt('cool', '', 'refactor')),
);
check('unknown preset falls back to native', H.buildSystemPrompt('hard', '', 'nonsense') === nativeSystem);
check('preset keeps the chosen voice', /肌肉集团总动员/.test(H.buildSystemPrompt('team', '', 'feat')));
check('empty preset argument stays native', H.buildSystemPrompt('hard', '', undefined) === nativeSystem);
check('preset skeletons cover every structured shape', JSON.stringify(Object.keys(H.PRESET_SKELETONS).sort()) === JSON.stringify(['feat', 'issue', 'refactor']));
check(
  'the user prompt asks for a Trellis card only when structured',
  /Trellis 任务书/.test(H.buildUserPrompt('写个周报', 'feat')) && !/Trellis 任务书/.test(H.buildUserPrompt('写个周报', 'native')),
);

check('user prompt fences the draft', H.buildUserPrompt('建模一架直升机').includes('<原始需求>\n建模一架直升机\n</原始需求>'));

const local = H.hardenLocally('  建模一架黑鹰直升机，细节拉满  ');
check('local fallback keeps the draft verbatim', local.includes('建模一架黑鹰直升机，细节拉满'));
check('local fallback is hardened', /哥们/.test(local) && /gogogo/.test(local) && /一次性交付/.test(local));

check('sanitize strips a code fence', H.sanitizeOutput('```\n哥们冲冲冲\n```') === '哥们冲冲冲');
check('sanitize strips a leading label', H.sanitizeOutput('改写后：哥们冲冲冲') === '哥们冲冲冲');
check('sanitize strips a trailing courtesy', H.sanitizeOutput('哥们冲冲冲\n\n如果需要我还可以继续优化') === '哥们冲冲冲');
check('sanitize keeps the body untouched', H.sanitizeOutput('哥们，直接给我整一个成品。') === '哥们，直接给我整一个成品。');
check('sanitize tolerates junk input', H.sanitizeOutput(undefined) === '' && H.sanitizeOutput(null) === '');

const cfg = H.normalizeConfig({ provider: 'a', model: 'b', maxTokens: 99, style: 'cool', nonsense: 1 });
check('config keeps an explicit route', cfg.provider === 'a' && cfg.model === 'b');
check('config rejects a half route', H.normalizeConfig({ provider: 'a' }).provider === '');
check('config keeps numbers and style', cfg.maxTokens === 99 && cfg.style === 'cool');
check('config defaults are sane', H.normalizeConfig(undefined).localFallback === true && H.normalizeConfig(undefined).style === 'hard');

// --- fake HTTP plumbing ----------------------------------------------------
function fakeRequest(method, url, body) {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')];
  return {
    method,
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(value) {
      this.body = value;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

/** A streaming `llm` stub that yields the supplied chunks and records the call. */
function fakeLlm(chunks, options) {
  const settings = options === undefined ? {} : options;
  const record = { calls: [] };
  return {
    record,
    listProviders: () => [{ id: 'fake-provider', name: 'Fake' }],
    listModels: async (provider) => [{ provider, id: 'fake-model' }],
    stream: (callOptions) => {
      const index = record.calls.length;
      record.calls.push(callOptions);
      if (settings.throwOnStream === true) throw Object.assign(new Error('boom'), { code: 'STREAM_BOOM' });
      // `[[call1], [call2]]` scripts a different answer per call (repair pass).
      const scripted = Array.isArray(chunks[0]);
      const current = scripted ? chunks[Math.min(index, chunks.length - 1)] || [] : chunks;
      return (async function* generate() {
        for (const chunk of current) yield chunk;
      })();
    },
  };
}

/** Mount the host half and return the captured handler. */
function mountHost(llm, config, agentDefaultModel) {
  const captured = { route: null, effects: 0 };
  const services = new Map();
  if (llm !== undefined) services.set('llm', llm);
  if (agentDefaultModel !== undefined) services.set('agentDefaultModel', agentDefaultModel);
  const ctx = {
    logger: { info: () => {}, warn: () => {} },
    get: (key) => services.get(key),
    effect: (callback) => {
      captured.effects += 1;
      const dispose = callback();
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
    webServer: {
      register: (registration) => {
        captured.route = registration;
        return () => {};
      },
    },
  };
  host.apply(ctx, config);
  check('host mounts one HTTP route', captured.route !== null && captured.route.path === H.ROUTE_PREFIX, JSON.stringify(captured.route && captured.route.path));
  check('host registers through ctx.effect', captured.effects >= 1, String(captured.effects));
  return captured.route.handler;
}

// --- GET /health -----------------------------------------------------------
{
  const handler = mountHost(fakeLlm([]), undefined);
  const res = fakeResponse();
  await handler(fakeRequest('GET', '/dsh-prompt-optimizer/health'), res);
  const body = res.json();
  check('health answers ok', res.statusCode === 200 && body.ok === true, JSON.stringify(body));
  check('health reports the version', body.version === H.VERSION, JSON.stringify(body));
  check('health lists the three flavours', Array.isArray(body.styles) && body.styles.join(',') === 'hard,team,cool', JSON.stringify(body.styles));
  check('health lists the task-card shapes', Array.isArray(body.presets) && body.presets.join(',') === 'native,feat,issue,refactor', JSON.stringify(body.presets));
  check('the plugin version is 0.6.1', H.VERSION === '0.6.1', H.VERSION);
}

// --- GET /models -----------------------------------------------------------
{
  const llm = fakeLlm([]);
  const handler = mountHost(llm, undefined, { currentSelection: () => ({ provider: 'seeded', model: 'seeded-model' }) });
  const res = fakeResponse();
  await handler(fakeRequest('GET', '/dsh-prompt-optimizer/models'), res);
  const body = res.json();
  check(
    'models lists the catalog and the current selection',
    res.statusCode === 200 &&
      body.ok === true &&
      body.current !== null &&
      body.current.provider === 'seeded' &&
      body.current.model === 'seeded-model' &&
      body.models.length === 1 &&
      body.models[0].provider === 'fake-provider' &&
      body.models[0].model === 'fake-model',
    JSON.stringify(body),
  );
  check('models carries the provider display name', body.models[0].providerName === 'Fake', JSON.stringify(body.models[0]));
  check('models falls back to the model id for its label', body.models[0].name === 'fake-model', JSON.stringify(body.models[0]));
}

{
  const handler = mountHost(undefined, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('GET', '/dsh-prompt-optimizer/models'), res);
  const body = res.json();
  check('models degrades to an empty catalog without an llm service', body.ok === true && body.current === null && body.models.length === 0, JSON.stringify(body));
}

// --- GET /model with an explicit route -------------------------------------
{
  const llm = fakeLlm([]);
  llm.resolveModelInfo = async () => ({
    reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' },
  });
  const handler = mountHost(llm, undefined, { currentSelection: () => ({ provider: 'seeded', model: 'seeded-model' }) });
  const res = fakeResponse();
  await handler(fakeRequest('GET', '/dsh-prompt-optimizer/model?provider=other&model=other-model'), res);
  const body = res.json();
  check('model accepts an explicit route', body.ok === true && body.provider === 'other' && body.model === 'other-model', JSON.stringify(body));
  check(
    'the explicit model advertises its own efforts',
    body.efforts.map((effort) => effort.id).join(',') === 'low,max' && body.effort === 'max',
    JSON.stringify(body),
  );
}

// --- POST /optimize, happy path -------------------------------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: HARDENED.slice(0, 10) },
    { type: 'text-delta', index: 0, text: HARDENED.slice(10) },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined, { currentSelection: () => ({ provider: 'seeded', model: 'seeded-model' }) });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  const body = res.json();
  check('optimize answers ok', res.statusCode === 200 && body.ok === true, JSON.stringify(body));
  check('optimize joins the text deltas', body.text === HARDENED, JSON.stringify(body.text));
  check('optimize reports the llm engine', body.engine === 'llm', String(body.engine));
  check('optimize uses the agent default route', body.route.provider === 'seeded' && body.route.model === 'seeded-model', JSON.stringify(body.route));
  const call = llm.record.calls[0];
  check('the model call carries a system prompt', typeof call.system === 'string' && call.system.includes('硬汉提示词锻造炉'));
  check('the model call carries one request-only user input', Array.isArray(call.messages) && call.messages.length === 1 && call.messages[0].role === 'user' && call.messages[0].id === undefined);
  check('the model call carries the fenced draft', call.messages[0].content[0].text.includes('<原始需求>\n写一个网页\n</原始需求>'));
  check('the native call leaves the ceiling to the adapter', call.maxTokens === undefined && typeof call.temperature === 'number', String(call.maxTokens));
  check('the model call inherits the route effort', call.reasoningEffort === undefined, String(call.reasoningEffort));
  check('the model call leaves the undeclared purpose out', call.purpose === undefined, String(call.purpose));
  check('the model call carries an abort signal', call.signal instanceof AbortSignal);
}

// --- POST /optimize, Trellis preset ---------------------------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: CARD },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '周报坏了', style: 'hard', preset: 'issue' })), res);
  const body = res.json();
  const call = llm.record.calls[0];
  check('optimize accepts the preset', body.ok === true && body.preset === 'issue', JSON.stringify({ preset: body.preset }));
  check('the preset reaches the system prompt', /workType: issue/.test(call.system), String(call.system).slice(0, 40));
  check('the preset reaches the user prompt', /Trellis 任务书/.test(call.messages[0].content[0].text), 'user prompt');
}

// --- POST /optimize, output hygiene ---------------------------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '以下是优化后的提示词：\n```\n' + HARDENED + '\n```\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '做个动画' })), res);
  const body = res.json();
  check('wrapped model output is unwrapped', body.text === HARDENED, JSON.stringify(body.text));
}

// --- POST /optimize, discovery when no default model ----------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: HARDENED },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '做个动画' })), res);
  const body = res.json();
  check('a route is discovered from the adapter catalog', body.ok === true && body.route.provider === 'fake-provider' && body.route.model === 'fake-model', JSON.stringify(body.route));
}

// --- POST /optimize, model failure falls back locally ---------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: 'partial' },
    { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: 'slow down' } } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '建模直升机' })), res);
  const body = res.json();
  check('a failed call still answers ok', res.statusCode === 200 && body.ok === true, JSON.stringify(body));
  check('a failed call falls back to the local forge', body.engine === 'local', String(body.engine));
  check('the fallback keeps the original draft', body.text.includes('建模直升机'));
  check('the failure is reported as a warning', body.warning !== undefined && body.warning.code === 'RATE_LIMIT', JSON.stringify(body.warning));
}

// --- POST /optimize, fallback disabled ------------------------------------
{
  const llm = fakeLlm([{ type: 'finish', reason: { kind: 'error', failure: { code: 'NO_ADAPTER', message: 'no such provider' } } }]);
  const handler = mountHost(llm, { localFallback: false });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '建模' })), res);
  const body = res.json();
  check('fallback off surfaces the failure', res.statusCode === 502 && body.ok === false, JSON.stringify(body));
  check('fallback off keeps the failure code', body.error.code === 'NO_ADAPTER', JSON.stringify(body.error));
}

// --- POST /optimize, bad inputs -------------------------------------------
{
  const handler = mountHost(fakeLlm([]), undefined);
  const empty = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '   ' })), empty);
  check('an empty draft is refused', empty.statusCode === 400 && empty.json().error.code === 'EMPTY_INPUT', empty.body);

  const bad = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', '{not json'), bad);
  check('a malformed body is refused', bad.statusCode === 400 && bad.json().error.code === 'BAD_JSON', bad.body);

  const long = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: 'x'.repeat(H.DEFAULTS.maxInputChars + 1) })), long);
  check('an oversized draft is refused', long.statusCode === 413 && long.json().error.code === 'INPUT_TOO_LONG', long.body);

  const missing = fakeResponse();
  await handler(fakeRequest('GET', '/dsh-prompt-optimizer/nope'), missing);
  check('an unknown route answers 404', missing.statusCode === 404 && missing.json().error.code === 'NOT_FOUND', missing.body);
}

// --- POST /optimize, no llm service at all --------------------------------
{
  const handler = mountHost(undefined, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '随便写点' })), res);
  const body = res.json();
  check('without an llm service the local forge still answers', res.statusCode === 200 && body.engine === 'local' && body.warning.code === 'NO_LLM', JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Client half
// ---------------------------------------------------------------------------
section('client half');

const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
let capturedModule = null;
const styleTags = [];
const storage = new Map();

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Symbol,
  navigator: { language: 'zh-CN' },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => {
      storage.set(key, String(value));
    },
    removeItem: (key) => {
      storage.delete(key);
    },
  },
  document: {
    querySelector: (selector) => (selector.includes('data-plugin-css') && styleTags.length > 0 ? styleTags[0] : null),
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: {
      appendChild: (tag) => {
        styleTags.push(tag);
      },
    },
  },
};
sandbox.window = { __ModuleLoader__: { load: (mod) => { capturedModule = mod; } } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(clientSource, sandbox, { filename: 'client.js' });

check('client registers itself with the module loader', capturedModule !== null, String(capturedModule));
check('client module id is the package name', capturedModule !== null && capturedModule.id === 'dsh-prompt-optimizer', JSON.stringify(capturedModule && capturedModule.id));
check('client module exposes a factory', capturedModule !== null && typeof capturedModule.factory === 'function');

const reactStub = {
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (callback) => callback,
};
const jsxRuntimeStub = {
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
  Fragment: Symbol('Fragment'),
};
const unknownRequests = [];
const clientExports = capturedModule.factory((specifier) => {
  if (specifier === 'react') return reactStub;
  if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
  unknownRequests.push(specifier);
  throw new Error('unexpected require: ' + specifier);
});

check('client requires only react and the jsx runtime', unknownRequests.length === 0, unknownRequests.join(', '));
check('client injects the slot + locale services', Array.isArray(clientExports.inject) && clientExports.inject.includes('slots') && clientExports.inject.includes('locale'), JSON.stringify(clientExports.inject));
check('client declares its endpoint', clientExports.ENDPOINT === '/dsh-prompt-optimizer/optimize', String(clientExports.ENDPOINT));
check('client declares a unique entry id', clientExports.ENTRY_ID === 'dsh-prompt-optimizer:hard-forge', String(clientExports.ENTRY_ID));
check('client ships both dictionaries', typeof clientExports.zh['button.idle'] === 'string' && typeof clientExports.en['button.idle'] === 'string');
check('client stylesheet covers the busy/done/error phases', /data-phase=busy/.test(clientExports.CSS) && /data-phase=done/.test(clientExports.CSS) && /data-phase=error/.test(clientExports.CSS));
check('client stylesheet honours reduced motion', /prefers-reduced-motion/.test(clientExports.CSS));

// The one visible string is pinned, in every state, to exactly `&#9794;harden`.
check(
  'client pins the visible label to the required string',
  clientExports.LABEL === '\u2642harden' &&
    [...clientExports.LABEL].length === 7 &&
    clientExports.LABEL.codePointAt(0) === 0x2642,
  JSON.stringify(clientExports.LABEL),
);
check(
  'every dictionary phase keeps the pinned label',
  ['idle', 'busy', 'done', 'error'].every((phase) => clientExports.zh['button.' + phase] === clientExports.LABEL) &&
    ['idle', 'busy', 'done', 'error'].every((phase) => clientExports.en['button.' + phase] === clientExports.LABEL),
  JSON.stringify(clientExports.zh),
);
check(
  'client stylesheet flows a gradient ring on the border box',
  /--dshPo-ring/.test(clientExports.CSS) &&
    /@keyframes dshPoFlow/.test(clientExports.CSS) &&
    /background-clip:padding-box,padding-box,border-box/.test(clientExports.CSS) &&
    /--dsw-alias-bg-layer-1/.test(clientExports.CSS),
);
check('client stylesheet keeps forced-colors legible', /forced-colors/.test(clientExports.CSS));
check('client stylesheet dropped the old bolt mark', !/dshPo_bolt/.test(clientExports.CSS));

const good = clientExports.readResult({ ok: true, text: ' 哥们冲 ', engine: 'local' }, 200);
check('readResult accepts a forged prompt', good.ok === true && good.text === ' 哥们冲 ' && good.engine === 'local');
const bad = clientExports.readResult({ ok: false, error: { code: 'BUSY', message: '人太多' } }, 429);
check('readResult maps a host failure', bad.ok === false && bad.error.code === 'BUSY' && bad.error.message === '人太多');
const junk = clientExports.readResult(null, 500);
check('readResult survives an unreadable answer', junk.ok === false && junk.error.code === 'BAD_RESPONSE');

const translateZh = clientExports.translator(undefined);
check('translator falls back to the local dictionary', translateZh('button.idle') === clientExports.zh['button.idle']);
check('translator uses the injected dictionary first', clientExports.translator((key) => 'T:' + key)('button.idle') === 'T:button.idle');
check('translator keeps unknown keys readable', translateZh('nope.missing') === 'nope.missing');

check('entry renders nothing without the composer props', clientExports.HardForgeEntry(null) === null && clientExports.HardForgeEntry({}) === null);
check('entry refuses a composer without setDraft', clientExports.HardForgeEntry({ useInput: () => '', inputActions: {} }) === null);
const withProps = clientExports.HardForgeEntry({ useInput: () => 'x', inputActions: { setDraft: () => {} }, t: undefined });
check('entry mounts the button once the props exist', withProps !== null && typeof withProps === 'object');

// Render one frame through the stub React and read the real element text.
{
  const flatText = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(flatText).join('');
    if (typeof node === 'object' && node.props !== undefined) return flatText(node.props.children);
    return '';
  };
  const rendered = withProps.type(withProps.props);
  const button = rendered.props.children[0];
  const visible = flatText(button);
  check('rendered button text is exactly the pinned label', visible === '\u2642harden', JSON.stringify(visible));
}

// --- the flavour picker ----------------------------------------------------
check(
  'client knows exactly the three flavours',
  Array.isArray(clientExports.STYLE_IDS) && clientExports.STYLE_IDS.join(',') === 'hard,team,cool',
  JSON.stringify(clientExports.STYLE_IDS),
);
check(
  'dictionaries name every flavour in both locales',
  ['hard', 'team', 'cool'].every(
    (id) =>
      typeof clientExports.zh['style.' + id] === 'string' &&
      typeof clientExports.en['style.' + id] === 'string' &&
      typeof clientExports.zh['style.' + id + '.hint'] === 'string' &&
      typeof clientExports.en['style.' + id + '.hint'] === 'string',
  ),
);
check(
  'the request body carries the picked flavour',
  JSON.stringify(clientExports.postBody('写个周报', 'team', 'feat', 'max', 'zh-CN')) ===
    JSON.stringify({ text: '写个周报', style: 'team', preset: 'feat', reasoningEffort: 'max', locale: 'zh-CN' }),
  JSON.stringify(clientExports.postBody('x', 'team', 'feat', 'max', 'zh-CN')),
);
check('an unknown flavour travels as hard', clientExports.postBody('x', 'nope', '').style === 'hard');
check('the body omits an empty locale', clientExports.postBody('x', 'hard', '', '', '').locale === undefined);
check('an empty effort is left out', clientExports.postBody('x', 'hard', 'native', '').reasoningEffort === undefined);
check('the effort rides along when picked', clientExports.postBody('x', 'hard', 'native', 'low').reasoningEffort === 'low');

const modelOk = clientExports.readModel(
  { ok: true, provider: 'p', model: 'm', effort: 'max', efforts: [{ id: 'low', name: '低' }, { id: 'max', name: '最高' }] },
  200,
);
check('the model description lists the efforts', modelOk.ok === true && modelOk.efforts.map((e) => e.id).join(',') === 'low,max', JSON.stringify(modelOk));
check('the model description carries the current effort', modelOk.effort === 'max', modelOk.effort);
const modelDown = clientExports.readModel({ ok: false, error: { code: 'NO_ROUTE', message: '没路由' } }, 200);
check('a missing model degrades quietly', modelDown.ok === false && modelDown.efforts.length === 0, JSON.stringify(modelDown));

const modelsOk = clientExports.readModels(
  {
    ok: true,
    current: { provider: 'p', model: 'm' },
    models: [
      { provider: 'p', providerName: 'P', model: 'm', name: 'M' },
      { provider: 'p', model: 'm2' },
    ],
  },
  200,
);
check(
  'the model catalog lists the current selection',
  modelsOk.ok === true && modelsOk.current.provider === 'p' && modelsOk.current.model === 'm',
  JSON.stringify(modelsOk),
);
check(
  'the model catalog keeps both provider and model',
  modelsOk.models.length === 2 && modelsOk.models[0].providerName === 'P' && modelsOk.models[1].name === 'm2',
  JSON.stringify(modelsOk.models),
);
const modelsDown = clientExports.readModels({ ok: false, error: { code: 'NO_LLM', message: '没服务' } }, 200);
check(
  'a missing catalog degrades quietly',
  modelsDown.ok === false && modelsDown.models.length === 0 && modelsDown.current === null,
  JSON.stringify(modelsDown),
);

const effortModel = {
  efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }],
  effort: 'high',
};
check(
  'a first visit starts on the model default',
  clientExports.resolveEffort(effortModel, '').effort === 'high' && clientExports.resolveEffort(effortModel, '').source === 'model',
);
check(
  'a later visit starts on the last picked effort',
  clientExports.resolveEffort(effortModel, 'max').effort === 'max' && clientExports.resolveEffort(effortModel, 'max').source === 'stored',
);
check('a stale effort falls back to the model default', clientExports.resolveEffort(effortModel, 'gone').effort === 'high');
check(
  'a model without efforts yields no effort row',
  clientExports.resolveEffort({ efforts: [], effort: 'max' }, 'max').effort === '' &&
    clientExports.resolveEffort({ efforts: [], effort: 'max' }, 'max').source === 'none',
);
check(
  'a model without a default starts on its first effort',
  clientExports.resolveEffort({ efforts: [{ id: 'only', name: 'Only' }], effort: '' }, '').effort === 'only',
);

check(
  'the request body carries the picked model',
  JSON.stringify(clientExports.postBody('x', 'hard', 'native', 'max', '', { provider: 'p', model: 'm' })) ===
    JSON.stringify({ text: 'x', style: 'hard', preset: 'native', reasoningEffort: 'max', provider: 'p', model: 'm' }),
  JSON.stringify(clientExports.postBody('x', 'hard', 'native', 'max', '', { provider: 'p', model: 'm' })),
);
check('a half route never travels', clientExports.postBody('x', 'hard', 'native', '', '', { provider: 'p' }).provider === undefined);

clientExports.rememberModel({ provider: 'p', model: 'm', manual: true });
check(
  'the forge model round-trips',
  clientExports.readStoredModel().provider === 'p' &&
    clientExports.readStoredModel().model === 'm' &&
    clientExports.readStoredModel().manual === true,
);
clientExports.rememberEffort('p', 'm', 'max');
check('the per-model effort round-trips', clientExports.readStoredEffort('p', 'm') === 'max');
clientExports.rememberLock({ provider: 'p', model: 'm', effort: 'max' });
check(
  'the lock snapshot round-trips',
  clientExports.readStoredLock().provider === 'p' && clientExports.readStoredLock().effort === 'max',
);
clientExports.clearStoredLock();
check('unlocking clears the snapshot', clientExports.readStoredLock() === null);
check('an unwritten model effort reads empty', clientExports.readStoredEffort('p', 'other') === '');

check(
  'the busy state paints an orbiting border marquee',
  /@property --dshPoAngle/.test(clientExports.CSS) &&
    /@keyframes dshPoOrbit/.test(clientExports.CSS) &&
    /data-phase=busy\]::before/.test(clientExports.CSS),
);
check(
  'the marquee stops under reduced motion',
  /prefers-reduced-motion:reduce\)\{[^}]*data-phase=busy\]::before/.test(clientExports.CSS),
);
check(
  'the model row has select and switch styles',
  /\.dshPo_modelRow\{/.test(clientExports.CSS) && /\.dshPo_select\{/.test(clientExports.CSS) && /\.dshPo_switch\{/.test(clientExports.CSS),
);
check(
  'the flat menu uses compact chips and controls',
  /\.dshPo_chip\{[^}]*height:26px/.test(clientExports.CSS) &&
    /\.dshPo_go\{[^}]*height:34px/.test(clientExports.CSS) &&
    /\.dshPo_switch\{[^}]*width:30px/.test(clientExports.CSS),
);
check(
  'the switch thumb slides when locked',
  /\.dshPo_switch\[data-locked=true\]::after\{transform:translateX\(14px\)/.test(clientExports.CSS),
);
check(
  'the menu rows never scroll',
  !/\.dshPo_pick\{[^}]*overflow-x:auto/.test(clientExports.CSS) &&
    !/\.dshPo_row\{[^}]*overflow-x:auto/.test(clientExports.CSS) &&
    !/\.dshPo_effortChips\{[^}]*overflow-x:auto/.test(clientExports.CSS),
);
check('the model row carries the effort chips', /\.dshPo_effortChips\{/.test(clientExports.CSS));
check(
  'dictionaries name the model row in both locales',
  typeof clientExports.zh['model.label'] === 'string' &&
    typeof clientExports.en['model.label'] === 'string' &&
    typeof clientExports.zh['model.lock'] === 'string' &&
    typeof clientExports.en['model.lock'] === 'string',
);
check('storage-less hosts fall back to hard', clientExports.readStoredStyle() === 'hard');
check(
  'stylesheet styles the flavour menu',
  /\.dshPo_pick\{/.test(clientExports.CSS) && /\.dshPo_chip\{/.test(clientExports.CSS),
);
check(
  'the pill carries no dropdown caret',
  !/\.dshPo_btn::after/.test(clientExports.CSS) && !/25BE/.test(clientExports.CSS),
);
check(
  'the menu has no close chrome',
  !/dshPo_cancel/.test(clientExports.CSS),
);
{
  const row = clientExports.CSS.match(/\.dshPo_row\{[^}]*\}/);
  check(
    'the flavours sit in one row that never wraps',
    row !== null && /flex-direction:row/.test(row[0]) && /flex-wrap:nowrap/.test(row[0]),
    row === null ? 'no rule' : row[0].slice(0, 120),
  );
  const pick = clientExports.CSS.match(/\.dshPo_pick\{[^}]*\}/);
  check(
    'the panel stacks the chips above a confirm button',
    pick !== null && /flex-direction:column/.test(pick[0]),
    pick === null ? 'no rule' : pick[0].slice(0, 120),
  );
  check(
    'the menu widens to fit its chips',
    pick !== null && /width:max-content/.test(pick[0]) && /max-width:/.test(pick[0]),
  );
}
check(
  'the flavour names are Chinese, not hard/team/cool',
  ['hard', 'team', 'cool'].every((id) => /^[\u4e00-\u9fa5]+$/.test(clientExports.zh['style.' + id])),
  ['hard', 'team', 'cool'].map((id) => clientExports.zh['style.' + id]).join(' / '),
);
check(
  'the English dictionary still says hard/team/cool',
  ['hard', 'team', 'cool'].every((id) => clientExports.en['style.' + id] === id),
);

// Render the open menu: the same factory loaded again, with a stateful React
// stub whose useState yields `picking = true` on the component's third call.
{
  let captured = null;
  const box = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Symbol,
    navigator: { language: 'zh-CN' },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
    },
  };
  box.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(clientSource, box, { filename: 'client.js' });
  // useState order inside HardForge: phase, note, picking, style.
  const preset = ['idle', '', true, 'cool'];
  let cursor = 0;
  const stateReact = {
    useState: (initial) => {
      const value = cursor < preset.length ? preset[cursor] : (typeof initial === 'function' ? initial() : initial);
      cursor += 1;
      return [value, () => {}];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
  };
  const mod = captured.factory((specifier) => {
    if (specifier === 'react') return stateReact;
    if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
    throw new Error('unexpected require: ' + specifier);
  });
  const tree = mod.HardForge({ useInput: () => '写个周报', inputActions: { setDraft: () => {} }, t: undefined });
  const pill = tree.props.children[0];
  const picker = tree.props.children[1];
  const row = picker.props.children[1];
  const modelRow = picker.props.children[0];
  const modelSelect = modelRow.props.children.find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'model-select',
  );
  const lockWrap = modelRow.props.children.find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'lock-wrap',
  );
  const lockButton = (lockWrap.props.children || []).find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'lock',
  );
  check(
    'the menu opens with a model row',
    modelRow.props['data-dsh-prompt-optimizer'] === 'model-row' && modelSelect !== undefined && lockButton !== undefined,
    JSON.stringify({ row: modelRow.props['data-dsh-prompt-optimizer'], select: Boolean(modelSelect), lock: Boolean(lockButton) }),
  );
  check(
    'the lock starts unlocked',
    lockButton.props['data-locked'] === 'false' && lockButton.props['aria-checked'] === 'false',
    JSON.stringify({ locked: lockButton.props['data-locked'], checked: lockButton.props['aria-checked'] }),
  );
  const forgeButton = (picker.props.children || []).find((child) => child !== null && child !== undefined && child.props !== undefined && child.props.className === 'dshPo_go');
  const chips = (row.props.children || []).filter(
    (child) => child !== null && child !== undefined && child.type === 'button' && child.props['data-style'] !== undefined,
  );
  check(
    'the pill stays mounted while the menu is open',
    pill.props.className === 'dshPo_btn' && pill.props['data-open'] === 'true' && pill.props['aria-expanded'] === 'true',
    JSON.stringify({ className: pill.props.className, open: pill.props['data-open'] }),
  );
  check(
    'clicking the pill reveals three flavour chips',
    picker.props['data-dsh-prompt-optimizer'] === 'picker' && chips.length === 3,
    String(chips.length),
  );
  check(
    'the chips are hard, team, cool in that order',
    chips.map((chip) => chip.props['data-style']).join(',') === 'hard,team,cool',
    chips.map((chip) => chip.props['data-style']).join(','),
  );
  check(
    'the remembered flavour is the one highlighted',
    chips.filter((chip) => chip.props['data-active'] === 'true').length === 1 &&
      chips.find((chip) => chip.props['data-active'] === 'true').props['data-style'] === 'cool',
  );
  check(
    'each chip is wired to pick its own flavour',
    chips.every((chip) => typeof chip.props.onClick === 'function'),
  );
  check(
    'the menu is two groups in one row plus a confirm button',
    row.props.children.length === 8 && forgeButton.props.className === 'dshPo_go',
    String(row.props.children.length) + '/' + forgeButton.props.className,
  );
  const presetChips = row.props.children.filter((child) => child.props['data-preset'] !== undefined);
  check(
    'the shape chips are native, feat, issue, refactor in that order',
    presetChips.map((chip) => chip.props['data-preset']).join(',') === 'native,feat,issue,refactor',
    presetChips.map((chip) => chip.props['data-preset']).join(','),
  );
  check(
    'the shape chips carry the Chinese labels',
    presetChips.map((chip) => chip.props.children.props.children).join(',') === '原生,需求,缺陷,重构',
    presetChips.map((chip) => chip.props.children.props.children).join(','),
  );
  check(
    'the highlighted shape is the remembered one',
    presetChips.filter((chip) => chip.props['data-active'] === 'true').length === 1 &&
      presetChips.find((chip) => chip.props['data-active'] === 'true').props['data-preset'] === 'native',
  );
  check(
    'a divider separates the two groups',
    row.props.children[3].props.className === 'dshPo_sep' && row.props.children[3].props['aria-hidden'] === 'true',
  );
  check(
    'the shape chips are wired to their own handler',
    presetChips.every((chip) => typeof chip.props.onClick === 'function'),
  );
  check(
    'the picker renders the model effort chips',
    /'effort-chips'/.test(clientSource) && /data-effort/.test(clientSource) && /MODEL_ENDPOINT/.test(clientSource),
  );
  check(
    'the effort chips sit above the forge button',
    clientSource.indexOf("'effort-chips'") > -1 && clientSource.indexOf("'effort-chips'") < clientSource.indexOf("className: 'dshPo_go'"),
  );
  check(
    'the request body carries the shape',
    /preset: shape/.test(clientSource) && /preset: 'native'/.test(clientSource) === false,
  );
  check(
    'Escape and an outside click still put the menu away',
    /event\.key === 'Escape'/.test(clientSource) && /addEventListener\('pointerdown'/.test(clientSource),
  );
}

// A locked menu freezes the model select and every effort chip.
{
  let captured = null;
  const box = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Symbol,
    navigator: { language: 'zh-CN' },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
    },
  };
  box.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(clientSource, box, { filename: 'client.js' });
  const preset = [
    'idle',
    '',
    true,
    'hard',
    'native',
    [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }],
    'max',
    [{ provider: 'p', providerName: 'P', model: 'm', name: 'M' }],
    { provider: 'p', model: 'm', manual: true },
    { provider: 'p', model: 'm', effort: 'max' },
  ];
  let cursor = 0;
  const stateReact = {
    useState: (initial) => {
      const value = cursor < preset.length ? preset[cursor] : (typeof initial === 'function' ? initial() : initial);
      cursor += 1;
      return [value, () => {}];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
  };
  const mod = captured.factory((specifier) => {
    if (specifier === 'react') return stateReact;
    if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
    throw new Error('unexpected require: ' + specifier);
  });
  const tree = mod.HardForge({ useInput: () => '写个周报', inputActions: { setDraft: () => {} }, t: undefined });
  const picker = tree.props.children[1];
  const modelRow = picker.props.children[0];
  const select = modelRow.props.children.find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'model-select',
  );
  const lockWrap = modelRow.props.children.find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'lock-wrap',
  );
  const lock = (lockWrap.props.children || []).find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'lock',
  );
  const lockLabel = (lockWrap.props.children || []).find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props.className === 'dshPo_lockLabel',
  );
  const effortChipsWrap = modelRow.props.children.find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'effort-chips',
  );
  const effortChips = (effortChipsWrap.props.children || []).filter(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-effort'] !== undefined,
  );
  check('a locked menu disables the model select', select.props.disabled === true, String(select.props.disabled));
  check(
    'a locked menu shows the locked switch',
    lock.props['data-locked'] === 'true' && lock.props['aria-checked'] === 'true' && lockLabel.props.children === '已锁定',
    JSON.stringify({ locked: lock.props['data-locked'], checked: lock.props['aria-checked'], label: lockLabel.props.children }),
  );
  check(
    'a locked menu disables every effort chip',
    effortChips.length === 2 && effortChips.every((chip) => chip.props.disabled === true),
    JSON.stringify(effortChips.map((chip) => chip.props.disabled)),
  );
}

// A model that advertises no efforts keeps the thinking row out entirely.
{
  let captured = null;
  const box = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Symbol,
    navigator: { language: 'zh-CN' },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
    },
  };
  box.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(clientSource, box, { filename: 'client.js' });
  const preset = [
    'idle',
    '',
    true,
    'hard',
    'native',
    [],
    '',
    [{ provider: 'p', providerName: 'P', model: 'm', name: 'M' }],
    { provider: 'p', model: 'm', manual: false },
    null,
  ];
  let cursor = 0;
  const stateReact = {
    useState: (initial) => {
      const value = cursor < preset.length ? preset[cursor] : (typeof initial === 'function' ? initial() : initial);
      cursor += 1;
      return [value, () => {}];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
  };
  const mod = captured.factory((specifier) => {
    if (specifier === 'react') return stateReact;
    if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
    throw new Error('unexpected require: ' + specifier);
  });
  const tree = mod.HardForge({ useInput: () => '写个周报', inputActions: { setDraft: () => {} }, t: undefined });
  const picker = tree.props.children[1];
  const modelRow = picker.props.children[0];
  const effortRows = (modelRow.props.children || []).filter(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props['data-dsh-prompt-optimizer'] === 'effort-chips',
  );
  check(
    'a model without efforts hides the effort row entirely',
    effortRows.length === 0 && (picker.props.children || []).filter((child) => child !== null && child !== undefined).length === 3,
    JSON.stringify({ effortRows: effortRows.length, rows: picker.props.children.length }),
  );
}

// An empty composer must not lock the menu: the pill stays clickable, and a
// flavour picked with nothing to forge says so instead of going quiet.
{
  let captured = null;
  const box = {
    console,
    setTimeout,
    clearTimeout,
    AbortController,
    Symbol,
    navigator: { language: 'zh-CN' },
    document: {
      querySelector: () => null,
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
    },
  };
  box.window = { __ModuleLoader__: { load: (mod) => { captured = mod; } } };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(clientSource, box, { filename: 'client.js' });

  const calls = [];
  const preset = ['idle', '', false, 'hard'];
  let cursor = 0;
  const stateReact = {
    useState: (initial) => {
      const index = cursor;
      const value = cursor < preset.length ? preset[cursor] : (typeof initial === 'function' ? initial() : initial);
      cursor += 1;
      return [value, (next) => { calls.push({ index, next }); }];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
  };
  const mod = captured.factory((specifier) => {
    if (specifier === 'react') return stateReact;
    if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
    throw new Error('unexpected require: ' + specifier);
  });
  const tree = mod.HardForge({ useInput: () => '', inputActions: { setDraft: () => {} }, t: undefined });
  const pill = tree.props.children[0];
  check(
    'an empty composer leaves the pill clickable',
    pill.props.disabled === undefined || pill.props.disabled === false,
    String(pill.props.disabled),
  );
  pill.props.onClick();
  const toggle = calls.filter((call) => call.index === 2).pop();
  check(
    'clicking it opens the menu even when the box is empty',
    typeof (toggle && toggle.next) === 'function' && toggle.next(false) === true,
  );
  // Second render with the menu already open, so the chips exist to be clicked.
  cursor = 0;
  const openReact = {
    useState: (initial) => {
      const index = cursor;
      const value = cursor < preset.length ? ['idle', '', true, 'hard'][cursor] : (typeof initial === 'function' ? initial() : initial);
      cursor += 1;
      return [value, (next) => { calls.push({ index, next }); }];
    },
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (callback) => callback,
  };
  const openMod = captured.factory((specifier) => {
    if (specifier === 'react') return openReact;
    if (specifier === 'react/jsx-runtime') return jsxRuntimeStub;
    throw new Error('unexpected require: ' + specifier);
  });
  const openTree = openMod.HardForge({ useInput: () => '', inputActions: { setDraft: () => {} }, t: undefined });
  const openMenu = openTree.props.children[1];
  const openRow = openMenu.props.children[1];
  const chips = (openRow.props.children || []).filter(
    (child) => child !== null && child !== undefined && child.type === 'button' && child.props['data-style'] !== undefined,
  );
  calls.length = 0;
  chips[0].props.onClick();
  check(
    'picking a flavour only remembers it, the menu stays open',
    calls.some((call) => call.index === 3 && call.next === 'hard') &&
      !calls.some((call) => call.index === 2),
    JSON.stringify(calls.map((call) => call.index + ':' + String(call.next))),
  );
  const forgeOnEmpty = (openMenu.props.children || []).find(
    (child) => child !== null && child !== undefined && child.props !== undefined && child.props.className === 'dshPo_go',
  ).props.onClick;
  calls.length = 0;
  forgeOnEmpty();
  check(
    'forging an empty box explains itself',
    calls.some((call) => call.index === 1 && typeof call.next === 'string' && call.next.length > 0) &&
      calls.some((call) => call.index === 0 && call.next === 'error'),
    JSON.stringify(calls.map((call) => call.index + ':' + String(call.next))),
  );
  const presetChipsOnEmpty = (openRow.props.children || []).filter(
    (child) => child !== null && child !== undefined && child.type === 'button' && child.props['data-preset'] !== undefined,
  );
  calls.length = 0;
  presetChipsOnEmpty[1].props.onClick();
  check(
    'picking a shape remembers it without closing the menu',
    calls.some((call) => call.index === 4 && call.next === 'feat') && !calls.some((call) => call.index === 2),
    JSON.stringify(calls.map((call) => call.index + ':' + String(call.next))),
  );
}

// --- mounting the client plugin -------------------------------------------
{
  const captured = { slot: null, locale: null, injectedSlot: null, effects: 0 };
  const ctx = {
    effect: (callback) => {
      captured.effects += 1;
      const dispose = callback();
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    },
    locale: {
      register: (namespace, dictionaries) => {
        captured.locale = { namespace, dictionaries };
        return () => {};
      },
    },
    slots: {
      inject: (slotName, callback) => {
        captured.injectedSlot = slotName;
        const dispose = callback();
        return () => {
          if (typeof dispose === 'function') dispose();
        };
      },
      register: (metadata, component) => {
        captured.slot = { metadata, component };
        return () => {};
      },
    },
  };
  clientExports.apply(ctx);
  check('client registers its dictionaries', captured.locale !== null && captured.locale.namespace === clientExports.NS, JSON.stringify(captured.locale && captured.locale.namespace));
  check('client dictionary carries both locales', captured.locale.dictionaries.zh !== undefined && captured.locale.dictionaries.en !== undefined);
  check('client brackets its slot with inject', captured.injectedSlot === 'conversation.input.left', String(captured.injectedSlot));
  check('client registers into the composer tool row', captured.slot !== null && captured.slot.metadata.name === 'conversation.input.left', JSON.stringify(captured.slot && captured.slot.metadata));
  check('client entry is ordered and namespaced', captured.slot.metadata.id === clientExports.ENTRY_ID && captured.slot.metadata.order === 30 && captured.slot.metadata.locale === clientExports.NS, JSON.stringify(captured.slot.metadata));
  check('client registers the entry component', captured.slot.component === clientExports.HardForgeEntry);
  check('client injects its stylesheet', styleTags.length === 1 && String(styleTags[0].dataset.pluginCss).startsWith('dsh-prompt-optimizer/'), String(styleTags.length));
  check('client used ctx.effect for its side effects', captured.effects >= 2, String(captured.effects));
}

// --- thin-answer guard -----------------------------------------------------
section('thin answers get re-forged');

check('a one-line answer counts as thin', H.isThin('哥们冲！', 'native') === true);
check('a structured brief passes the thin check', H.isThin(HARDENED, 'native') === false);
check('a task card passes the thin check', H.isThin(CARD, 'issue') === false);
check('a two-line card is still thin', H.isThin('## 任务：x\n## 现象\ny', 'issue') === true);
check(
  'the local envelope lists one bullet per clause',
  H.hardenLocally('写脚本；不改文件名；支持 jpg').includes('- 写脚本：') &&
    H.hardenLocally('写脚本；不改文件名；支持 jpg').includes('- 不改文件名：'),
);

{
  const llm = fakeLlm([
    [
      { type: 'text-delta', index: 0, text: '哥们，直接给我整一个成品，gogogo！' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
    [
      { type: 'text-delta', index: 0, text: HARDENED },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  const body = res.json();
  check('a one-line answer is re-forged', body.engine === 'llm' && body.text === HARDENED, JSON.stringify({ engine: body.engine }));
  check('the repair is reported', body.warning !== undefined && body.warning.code === 'EXPANDED', JSON.stringify(body.warning));
  check('the repair asks for the missing rows', /上一版被打回/.test(llm.record.calls[1].messages[0].content[0].text), 'repair prompt');
}

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '哥们冲！' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写脚本；不改文件名；支持 jpg' })), res);
  const body = res.json();
  check('a model that keeps compressing falls back to the envelope', body.engine === 'local' && body.warning.code === 'THIN_OUTPUT', JSON.stringify({ engine: body.engine, warning: body.warning }));
  check('the fallback still keeps every clause', body.text.includes('- 不改文件名：') && body.text.includes('- 支持 jpg：'), body.text.slice(0, 80));
}

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '## 任务：x\n## 现象\ny' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '周报坏了', preset: 'issue' })), res);
  const body = res.json();
  check('a stub card never ships as a task card', res.statusCode === 502 && body.error.code === 'PRESET_NEEDS_MODEL', JSON.stringify(body.error));
}

// ---------------------------------------------------------------------------
// --- follow the host's model configuration ---------------------------------
section('model config');

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: HARDENED },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined, {
    currentSelection: () => ({ provider: 'seeded', model: 'seeded-model', reasoningEffort: 'max' }),
  });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  check('the route effort is inherited from the deployment', llm.record.calls[0].reasoningEffort === 'max', String(llm.record.calls[0].reasoningEffort));
  check('no budget is invented', llm.record.calls[0].maxTokens === undefined, String(llm.record.calls[0].maxTokens));
}

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: HARDENED },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, { maxTokens: 1234, reasoningEffort: 'high' });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  check('an explicit row budget wins', llm.record.calls[0].maxTokens === 1234, String(llm.record.calls[0].maxTokens));
  check('an explicit row effort wins', llm.record.calls[0].reasoningEffort === 'high', String(llm.record.calls[0].reasoningEffort));
}

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: HARDENED },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined, { currentSelection: () => ({ provider: 'seeded', model: 'seeded-model' }) });
  const res = fakeResponse();
  await handler(
    fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页', provider: 'picked', model: 'picked-model' })),
    res,
  );
  const body = res.json();
  check('an explicit forge model wins the route', body.route.provider === 'picked' && body.route.model === 'picked-model', JSON.stringify(body.route));
  check(
    'the model call uses the picked route',
    llm.record.calls[0].provider === 'picked' && llm.record.calls[0].model === 'picked-model',
    JSON.stringify({ provider: llm.record.calls[0].provider, model: llm.record.calls[0].model }),
  );
}

// --- the diagnostic probe --------------------------------------------------
section('probe route');

{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '哥们儿在这儿' },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/probe', JSON.stringify({ text: '你好', maxTokens: 1234 })), res);
  const body = res.json();
  check('the probe answers with what the model did', body.ok === true && body.chars === 6, JSON.stringify(body).slice(0, 160));
  check('the probe reports the finish reason', body.finish !== null && body.finish.kind === 'stop', JSON.stringify(body.finish));
  check('the probe honours the budget it was given', llm.record.calls[0].maxTokens === 1234, String(llm.record.calls[0].maxTokens));
}

// --- adapters that reject the thinking budget ------------------------------
section('effort fallback');

{
  const seen = [];
  const llm = {
    listProviders: () => [{ id: 'fake-provider', name: 'Fake' }],
    listModels: async (provider) => [{ provider, id: 'fake-model' }],
    stream: (options) => {
      seen.push(options);
      if (seen.length === 1) throw Object.assign(new Error('no such effort'), { code: 'UNSUPPORTED_REASONING_EFFORT' });
      return (async function* generate() {
        yield { type: 'text-delta', index: 0, text: HARDENED };
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
  const handler = mountHost(llm, { reasoningEffort: 'low' });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  const body = res.json();
  check('an adapter without this effort still answers', body.ok === true && body.text === HARDENED, JSON.stringify(body).slice(0, 120));
  check('the effort from the config row is sent first', seen[0].reasoningEffort === 'low', String(seen[0].reasoningEffort));
  check('the retry drops the effort', seen.length === 2 && seen[1].reasoningEffort === undefined, String(seen.length));
}

console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ' — ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed === 0 ? 0 : 1;
