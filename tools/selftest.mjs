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
      record.calls.push(callOptions);
      if (settings.throwOnStream === true) throw Object.assign(new Error('boom'), { code: 'STREAM_BOOM' });
      return (async function* generate() {
        for (const chunk of chunks) yield chunk;
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
}

// --- POST /optimize, happy path -------------------------------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '哥们，' },
    { type: 'text-delta', index: 0, text: '直接给我整一个成品，gogogo！' },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined, { currentSelection: () => ({ provider: 'seeded', model: 'seeded-model' }) });
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '写一个网页' })), res);
  const body = res.json();
  check('optimize answers ok', res.statusCode === 200 && body.ok === true, JSON.stringify(body));
  check('optimize joins the text deltas', body.text === '哥们，直接给我整一个成品，gogogo！', JSON.stringify(body.text));
  check('optimize reports the llm engine', body.engine === 'llm', String(body.engine));
  check('optimize uses the agent default route', body.route.provider === 'seeded' && body.route.model === 'seeded-model', JSON.stringify(body.route));
  const call = llm.record.calls[0];
  check('the model call carries a system prompt', typeof call.system === 'string' && call.system.includes('硬汉提示词锻造炉'));
  check('the model call carries one request-only user input', Array.isArray(call.messages) && call.messages.length === 1 && call.messages[0].role === 'user' && call.messages[0].id === undefined);
  check('the model call carries the fenced draft', call.messages[0].content[0].text.includes('<原始需求>\n写一个网页\n</原始需求>'));
  check('the model call sets a sampling ceiling', call.maxTokens === H.DEFAULTS.maxTokens && typeof call.temperature === 'number');
  check('the model call declares its purpose', call.purpose === 'prompt-optimizer');
  check('the model call carries an abort signal', call.signal instanceof AbortSignal);
}

// --- POST /optimize, output hygiene ---------------------------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '以下是优化后的提示词：\n```\n哥们，细节拉满！\n```\n' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]);
  const handler = mountHost(llm, undefined);
  const res = fakeResponse();
  await handler(fakeRequest('POST', '/dsh-prompt-optimizer/optimize', JSON.stringify({ text: '做个动画' })), res);
  const body = res.json();
  check('wrapped model output is unwrapped', body.text === '哥们，细节拉满！', JSON.stringify(body.text));
}

// --- POST /optimize, discovery when no default model ----------------------
{
  const llm = fakeLlm([
    { type: 'text-delta', index: 0, text: '哥们冲！' },
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

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  Symbol,
  navigator: { language: 'zh-CN' },
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
  JSON.stringify(clientExports.postBody('写个周报', 'team', 'zh-CN')) ===
    JSON.stringify({ text: '写个周报', style: 'team', locale: 'zh-CN' }),
  JSON.stringify(clientExports.postBody('x', 'team', 'zh-CN')),
);
check('an unknown flavour travels as hard', clientExports.postBody('x', 'nope', '').style === 'hard');
check('the body omits an empty locale', clientExports.postBody('x', 'hard', '').locale === undefined);
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
  const pick = clientExports.CSS.match(/\.dshPo_pick\{[^}]*\}/);
  check(
    'the flavours sit in one row that never wraps',
    pick !== null && /flex-direction:row/.test(pick[0]) && /flex-wrap:nowrap/.test(pick[0]),
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
      const value = cursor < preset.length ? preset[cursor] : initial;
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
  const chips = (picker.props.children || []).filter(
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
    'the menu is three chips and nothing else',
    picker.props.children.length === 3 && picker.props.children.every((child) => child.props.className === 'dshPo_chip'),
    String(picker.props.children.length),
  );
  check(
    'Escape and an outside click still put the menu away',
    /event\.key === 'Escape'/.test(clientSource) && /addEventListener\('pointerdown'/.test(clientSource),
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
      const value = cursor < preset.length ? preset[cursor] : initial;
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
      const value = cursor < preset.length ? ['idle', '', true, 'hard'][cursor] : initial;
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
  const chips = (openTree.props.children[1].props.children || []).filter(
    (child) => child !== null && child !== undefined && child.type === 'button' && child.props['data-style'] !== undefined,
  );
  calls.length = 0;
  chips[0].props.onClick();
  check(
    'picking a flavour on an empty box explains itself',
    calls.some((call) => call.index === 1 && typeof call.next === 'string' && call.next.length > 0) &&
      calls.some((call) => call.index === 0 && call.next === 'error'),
    JSON.stringify(calls.map((call) => call.index + ':' + String(call.next))),
  );
  check(
    'and it still remembers the flavour it picked',
    calls.some((call) => call.index === 3 && call.next === 'hard'),
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

// ---------------------------------------------------------------------------
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ' — ' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed === 0 ? 0 : 1;
