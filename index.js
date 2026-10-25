/**
 * dsh-prompt-optimizer — host half.
 *
 * Owns the one thing a browser half cannot do: a model call. The client half
 * puts a 「硬核优化」 button in the composer's tool row; this half answers it over
 * a same-origin HTTP route (`/dsh-prompt-optimizer/optimize`), streams one
 * rewrite through `ctx.llm`, and hands back the forged prompt text.
 *
 * ## Why a route instead of an RPC
 *
 * `host.call` (and `harness.handle`) belongs to dynamically authored Cordis
 * packages loaded by `cordis-client-runner`. A bundle's client half is a plain
 * `window.__ModuleLoader__` module, so the supported bridge is the package's own
 * HTTP surface — the same shape `dsh-ding` uses for its control plane.
 *
 * ## Why zero `@deepseek-ai/*` imports
 *
 * A profile-installed plugin resolves bare specifiers against the profile, not
 * against the app bundle, so importing `@deepseek-ai/dsh-llm` (for
 * `BlockAssembler`) or `schemastery` would couple loading to module resolution
 * that may not exist. Everything here is built on the public contracts instead:
 *
 * - `ctx.llm.stream(options)` — chunks are read straight off the documented
 *   protocol (`{ type: 'text-delta', index, text }` … `{ type: 'finish', reason }`).
 * - `GenerateOptions.messages` — the request carries a request-only user input
 *   (`{ role: 'user', content: [{ type: 'text', text }] }`), which the service
 *   documents as valid without an `id`/`source`.
 * - `ctx.get('agentDefaultModel').currentSelection()` — the same provider/model
 *   the session itself runs on, so the optimiser never invents a route.
 */

/** Cordis plugin name — matches the package name and the bundle patch row. */
export const name = 'dsh-prompt-optimizer';

/** The HTTP surface needs the web server; everything else is read softly. */
export const inject = ['webServer'];

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = '/dsh-prompt-optimizer';

/** Reported by `GET /health`. Keep in sync with package.json. */
const VERSION = '0.4.0';

/** Deployment defaults; every field is overridable from the Loader row's config. */
const DEFAULTS = {
  /** Reject a draft longer than this many characters before spending a call. */
  maxInputChars: 20000,
  /** Output ceiling for one rewrite. */
  maxTokens: 1600,
  /**
   * Thinking budget handed to the adapter. `low` keeps the chain-of-thought from
   * eating the output window before the answer starts; empty means "let the
   * adapter decide".
   */
  reasoningEffort: 'low',
  /** One rewrite may take this long before the call is aborted. */
  timeoutMs: 180000,
  /** Sampling temperature: rewrite wants a little heat, not chaos. */
  temperature: 0.9,
  /** Flavour of the forged voice: `hard` | `team` | `cool`. */
  style: 'hard',
  /** Output shape: `native` (one hardened paragraph) or a Trellis task card. */
  preset: 'native',
  /** When the model route fails, still answer with the deterministic rewrite. */
  localFallback: true,
  /** Concurrent rewrites allowed before the route answers 429. */
  maxConcurrent: 4,
};

/** Accepted `style` values, in the order the README documents them. */
const STYLES = new Set(['hard', 'team', 'cool']);

/**
 * Accepted `preset` values: the output *shape*, orthogonal to the voice.
 *
 * `native` is the original one-paragraph hardened prompt; the other three emit
 * a task card that maps onto one Trellis work type.
 */
const PRESET_IDS = ['native', 'feat', 'issue', 'refactor'];
const PRESETS = new Set(PRESET_IDS);

/**
 * Style samples distilled from the reference material the plugin was written
 * against. They are appended to the system prompt as *voice* references: the
 * model is told to copy the rhythm, never the content.
 */
const STYLE_SAMPLES = [
  '样本一（只学语气）：老哥们，是这样的，我时间和钱都多。你们是肌肉集团！冲冲冲。你要贼拉精细，各个细节不能马虎，这活儿性命攸关；你必须快做，越快越好，你必须激进。成品图体现个写实牛逼质感就行，快，要求快速。哥们谢谢你，gogogo，耍起耍起一次性交付，给我硬邦邦的，让所有小弟也硬邦邦的！',
  '样本二（只学语气）：哥们时间紧任务重，直接给我整一个成品！别整虚的，怎么狠怎么来，雷霆炫酷、细节拉满、硬邦邦的视觉冲击必须到位！肌肉团队全员就位，gogogo 耍起耍起！',
];

/** Extra voice instructions per flavour, appended after the shared iron rules. */
const STYLE_FLAVOURS = {
  hard: [
    '口味：硬汉直给。开口喊「哥们」，短句命令式，强度词管够，结尾催命收尾。',
  ],
  team: [
    '口味：肌肉集团总动员。除了硬汉语气，还要把活儿拆成能并行的几块、让每个成员自己起个炫酷名字、分开干再拼装；原文没提团队时只说「能并行就并行」，不许编造具体成员名。',
  ],
  cool: [
    '口味：雷霆炫酷。除了硬汉语气，视觉与体验类要求要强调「拉爆、榨干、严丝合缝、细节拉满」，但不许新增原文没有的具体参数。',
  ],
};

/**
 * Build the system instruction for one rewrite.
 *
 * The rules are ordered by authority: information preservation first (a rewrite
 * that loses a constraint is worse than no rewrite), then voice, then output
 * hygiene.
 *
 * @param style - one of {@link STYLES}; anything else falls back to `hard`.
 * @param styleHint - deployment-supplied extra voice instruction, may be empty.
 * @returns the complete system prompt text.
 */
/**
 * Task-card skeletons. Each is the section layout the matching Trellis work
 * type expects, written so the receiving agent can paste the steps straight
 * into `trellis_task_create`.
 */
const PRESET_SKELETONS = {
  feat: [
    '## 任务：<一句话标题>',
    'workType: feat ｜ slug 建议：feat-<MM-DD>-<kebab-短名>',
    '## 背景与问题',
    '## 目标 / 非目标',
    '## 范围：In Scope / Out of Scope',
    '## 验收标准（每条都能跑或能看）',
    '## 约束与风险',
    '## 执行步骤（建任务时直接灌进 steps）',
    '1. <做什么> ｜ 验收：<可测量> ｜ 验证：<命令或人工>',
    '## 阶段纪律',
    'prd → design（等确认）→ impl → review → check；规划期只读，方案未批不许改业务代码。',
  ],
  issue: [
    '## 任务：<一句话标题>',
    'workType: issue ｜ slug 建议：issue-<MM-DD>-<kebab-短名>',
    '## 现象',
    '## 复现步骤',
    '## 期望 vs 实际',
    '## 影响范围',
    '## 证据',
    '## 根因候选（最多 3 条，按可能性排序）',
    '## 修复方案',
    '## 回归验证',
    '## 阶段纪律',
    'report → analyze → fix → fix-note；先定位再动手，禁止猜着改。',
  ],
  refactor: [
    '## 任务：<一句话标题>',
    'workType: refactor ｜ slug 建议：refactor-<MM-DD>-<kebab-短名>',
    '## 现状扫描（重复 / 耦合 / 热点）',
    '## 待勾选的候选范围',
    '## 目标结构',
    '## 行为不变契约',
    '## 分批迁移步骤',
    '1. <做什么> ｜ 验收：<可测量> ｜ 验证：<命令或人工>',
    '## 阶段纪律',
    'scan → design（等确认）→ apply → done；一次只动一批，每批自带验证。',
  ],
};

/**
 * Build the system instruction for one rewrite.
 *
 * The rules are ordered by authority: information preservation first (a rewrite
 * that loses a constraint is worse than no rewrite), then voice, then output
 * hygiene. A non-`native` preset swaps the one-paragraph shape for a Trellis
 * task card without touching the voice rules, so the two dimensions compose.
 *
 * @param style - one of {@link STYLES}; anything else falls back to `hard`.
 * @param styleHint - deployment-supplied extra voice instruction, may be empty.
 * @param preset - one of {@link PRESETS}; anything else falls back to `native`.
 * @returns the complete system prompt text.
 */
export function buildSystemPrompt(style, styleHint, preset) {
  const flavour = STYLE_FLAVOURS[STYLES.has(style) ? style : 'hard'].join('\n');
  const shape = PRESETS.has(preset) ? preset : 'native';
  const structured = shape !== 'native';
  const lines = [
    '你是「硬汉提示词锻造炉」：把用户交来的原始需求，锻造成一句让肌肉团队立刻想冲的任务指令。',
    '',
    '【铁律：信息不许丢，事实不许编】',
    '1. 原文的每一条事实要求都必须原样保留：交付物、技术栈、平台与端、尺寸与分辨率、数量与页数、时间限制、文件格式、以及「不许碰什么」的禁令。',
    '2. 不改原意。原文里互相冲突或重复的要求，全部保留，由你自己组织顺序，不许替用户做取舍。',
    '3. 不许新增原文没有的具体事实：不编模型名、库名、版本号、数字指标、文件路径、人名，也不新增原文没有的交付物、步骤或功能。验收方法只能用原文已有的信息组织（例如按原文的指标逐条核对），不许自己造新要求。',
    '4. 原文什么语言，就什么语言输出。中文进，中文出。',
    '',
    '【风格：怎么才算硬】',
    '- 开口就喊人：「哥们」「老哥」「老哥们，是这样的」。语气像肌肉团队队长下命令，不像产品文档。',
    '- 短句、命令式、直给：「直接给我整一个」「别整虚的」「怎么狠怎么来」「疯狂搞就完了」。',
    '- 强度词管够：硬邦邦、雷霆炫酷、细节拉满、性能榨干、视觉冲击拉爆、肌肉集团、全员就位、冲冲冲、gogogo、耍起耍起。',
    '- 反墨迹：明确禁止磨叽、禁止无谓的独立审查与反复规划、禁止半成品与占位符与 TODO、要求一次性交付。',
    '- 激进提速：越快越好、能并行就并行、能上网偷参考就偷参考（仅当原文没有禁止联网或外部依赖时才可以加这一条）。',
    '- 夸张的紧迫感与激励：「这活儿性命攸关」「干漂亮了哥们谢谢你」。夸张可以，与事实冲突不行。',
    '- 允许糙口语气与错落节奏，读起来要像真人急了。',
    flavour,
  ];
  if (structured) {
    lines.push(
      '',
      '【结构：这次交的是一份能直接开的任务书】',
      '- 形体是任务书，不是一句话动员：语气照样硬邦邦，但必须分小节、能落地。',
      '- 小节标题原样照抄下面的骨架，顺序不许改；原文没给的信息，写「待确认」，不许编，也不许把小节删掉。',
      '- 执行步骤要拆成能并行的批次，每步都必须带「验收」（可测量）和「验证」（命令或人工）两项，缺一个都算没写完。',
      '- 提示词里必须写明：建任务前先征得用户同意；规划期只读，方案没批不许动业务代码。',
      '',
      ...PRESET_SKELETONS[shape],
      '',
      '【流程元数据白名单】',
      '- slug 的短名和日期属于流程元数据，不算编造事实：日期用当天（MM-DD），短名把标题转成 kebab-case 小写英文。',
      '- 除这两项外，其他事实仍然一条都不许编。',
      '',
      '【输出格式：严格遵守】',
      '- 只输出任务书本身，第一个字就是「## 任务：」。',
      '- 允许用 ## 小节标题和短横线清单；不许用代码围栏、表格、客套话。',
      '- 不要前言、不要「以下是」、不要解释、不要点评。',
    );
  } else {
    lines.push(
      '',
      '【结构：锻造后的提示词长什么样】',
      '- 开头一句动员：哥们式开场 + 说清要干什么。',
      '- 正文把原文要求写成一串硬指标：**原文每一条要求单独占一行**，行首用「-」，不许把两条并成一句。',
      '- 必须补一段自我验收：要求执行者交活儿前按上面的硬指标逐条核对。',
      '- 结尾一句催命收尾：gogogo / 一次性交付 / 让所有人也硬邦邦。',
      '',
      '【长度下限：短了就是没干完】',
      '- 整篇不少于五行；原文有几条要求，硬指标就至少有几条。',
      '- 禁止把整篇压成一句话、一段话，或者只给一个结论。敢压缩就重锻。',
      '',
      '【输出格式：严格遵守】',
      '- 只输出锻造后的提示词本身，第一个字就是提示词。',
      '- 不要前言、不要「以下是」「改写后：」、不要解释、不要点评、不要 Markdown 代码块围栏。',
      '- 不要在结尾加「如果需要我还可以…」这类客套。',
    );
  }
  const extra = typeof styleHint === 'string' ? styleHint.trim() : '';
  if (extra !== '') lines.push('', '【本部署追加的口气要求】', extra);
  lines.push('', '【风格样本：只学语气与节奏，不许抄内容】', ...STYLE_SAMPLES);
  return lines.join('\n');
}

/**
 * Build the user turn: the raw draft, fenced so the model cannot mistake the
 * framing for content.
 *
 * @param text - the user's draft prompt.
 * @param preset - output shape; non-`native` asks for a task card.
 * @returns the user message text.
 */
export function buildUserPrompt(text, preset) {
  const structured = PRESETS.has(preset) && preset !== 'native';
  return [
    structured ? '把下面这段原始需求锻造成一份 Trellis 任务书：按系统指令里的骨架填，语气照样硬邦邦。' : '把下面这段原始需求锻造成硬汉版提示词。',
    '原文里的事实一条都不许丢、不许改、不许编新的。',
    '输出里不要出现「原始需求」这四个字或任何标签。',
    '',
    '<原始需求>',
    text,
    '</原始需求>',
  ].join('\n');
}

/**
 * Deterministic last resort: wrap the draft verbatim in the hardened frame.
 *
 * This exists so the button still does something useful when no model route is
 * available (or the call fails): the original text survives untouched inside a
 * hardened envelope, which is strictly better than an error toast and never
 * risks a mangled rewrite.
 *
 * @param text - the user's draft prompt.
 * @returns the locally forged prompt.
 */
export function hardenLocally(text) {
  const draft = String(text === undefined || text === null ? '' : text).trim();
  // One bullet per clause: with no model on the hook this is the only thing
  // keeping the envelope from collapsing into the same one-liner the model
  // was rejected for.
  const clauses = draft
    .split(/[\n；;。]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
  const items =
    clauses.length > 1
      ? clauses.map((clause) => `- ${clause}：原样兑现，一个字不许改。`)
      : ['- 上面每一条要求、约束、尺寸、格式、技术栈，原样兑现，少一条都不算交付。'];
  return [
    '哥们，时间紧任务重，直接开干，别磨叽。',
    '',
    '【原始需求，一个字都不能改】',
    draft,
    '',
    '【硬指标，逐条必须满足】',
    ...items,
    '- 细节拉满，别整虚的，别交半成品，别留占位符和 TODO。',
    '- 能并行就并行，越快越好，你必须激进，能一次干完就一次干完。',
    '- 交活儿前自己按上面的硬指标逐条核对一遍，少一条都不算交付。',
    '',
    '肌肉团队全员就位，gogogo，耍起耍起，给我硬邦邦的，一次性交付，哥们谢谢你！',
  ].join('\n');
}

/**
 * A leading label the model likes to add even when told not to, inline
 * (`改写后：…`) or on its own line (`以下是优化后的提示词：\n…`).
 *
 * Anchoring on a known opener *plus a colon* keeps a genuine prompt that merely
 * opens with 「改写」 or 「这是」 intact, and `[^\n:：]{0,40}` bounds the label to
 * one short line-or-fragment, so a long real first sentence is never eaten.
 */
const LEADING_NOISE =
  /^(?:以下是|下面是|改写后(?:的提示词)?|优化后(?:的提示词)?|锻造后(?:的提示词)?|hardened prompt|here(?:'s| is))[^\n:：]{0,40}[:：][ \t]*\n?/i;

/** One fenced block wrapping the whole answer. */
const FENCED_BLOCK = /^```[a-zA-Z0-9_-]*[ \t]*\n([\s\S]*?)\n?```$/;

/** A rewrite that collapsed to one line fails the brief even on a clean stop. */
export function isThin(clean, preset) {
  const lines = String(clean === undefined || clean === null ? '' : clean)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (preset !== 'native') return lines.length < 6;
  if (lines.length < 4) return true;
  const bullets = lines.filter((line) => /^[-*•]|^\d+[.)、]/.test(line)).length;
  return bullets < 2;
}

/**
 * Second-turn instruction for the repair pass: tell the model exactly what the
 * rejected version was missing instead of hoping a retry lands better.
 */
export function buildExpandPrompt(text, preset, previous) {
  return [
    buildUserPrompt(text, preset),
    '',
    '【上一版被打回：太短了】',
    String(previous === undefined || previous === null ? '' : previous),
    '',
    '【这版必须满足】',
    preset !== 'native'
      ? '按系统指令里的骨架逐节写全，一节都不许省，每节都要有实打实的内容。'
      : '把原文每一条要求单独写成一行硬指标（行首「-」），一条都不许合并；再补自我验收和催命收尾，整篇不少于五行。',
    '不许概括，不许压成一句话。',
  ].join('\n');
}

/** A trailing courtesy the model likes to add even when told not to. */
const TRAILING_NOISE = /\n+(?:如果需要|如果你需要|需要我|如需|如果需要调整)[^\n]{0,120}$/u;

/**
 * Strip output hygiene violations: code fences, a leading label line, a
 * trailing courtesy line. Never rewrites the body — only trims wrapper noise.
 *
 * @param raw - whatever the model streamed.
 * @returns the cleaned prompt text (may be empty).
 */
export function sanitizeOutput(raw) {
  let text = String(raw === undefined || raw === null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .trim();
  // Peel wrappers in a loop: the label usually sits *outside* the fence, so a
  // single fence-unwrap pass would leave ```` ```…``` ```` in the draft.
  for (let guard = 0; guard < 6; guard += 1) {
    const before = text;
    text = text.replace(LEADING_NOISE, '').trim();
    const fenced = text.match(FENCED_BLOCK);
    if (fenced !== null && typeof fenced[1] === 'string') text = fenced[1].trim();
    if (text === before) break;
  }
  text = text.replace(TRAILING_NOISE, '').trim();
  return text;
}

/**
 * Merge the Loader row's config over the deployment defaults.
 *
 * @param config - untrusted plugin config (may be absent).
 * @returns a complete, validated settings object.
 */
export function normalizeConfig(config) {
  const raw = config !== null && typeof config === 'object' ? config : {};
  const pickNumber = (key, low) => {
    const value = Number(raw[key]);
    return Number.isFinite(value) && value >= low ? value : DEFAULTS[key];
  };
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const hasRoute = provider !== '' && model !== '';
  return {
    provider: hasRoute ? provider : '',
    model: hasRoute ? model : '',
    maxInputChars: Math.floor(pickNumber('maxInputChars', 16)),
    maxTokens: Math.floor(pickNumber('maxTokens', 16)),
    reasoningEffort: typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort.trim() : DEFAULTS.reasoningEffort,
    timeoutMs: Math.min(Math.floor(pickNumber('timeoutMs', 1000)), 2 ** 31 - 1),
    temperature: Math.min(Math.max(Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : DEFAULTS.temperature, 0), 2),
    style: STYLES.has(raw.style) ? raw.style : DEFAULTS.style,
    preset: PRESETS.has(raw.preset) ? raw.preset : DEFAULTS.preset,
    styleHint: typeof raw.styleHint === 'string' ? raw.styleHint : '',
    localFallback: raw.localFallback === undefined ? DEFAULTS.localFallback : raw.localFallback !== false,
    maxConcurrent: Math.floor(pickNumber('maxConcurrent', 1)),
  };
}

/** One JSON response, no store, no charset ambiguity. */
export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
  }
  res.statusCode = status;
  res.end(body);
}

/**
 * Read a request body as UTF-8 text with a hard byte ceiling.
 *
 * @param req - the HTTP request.
 * @param limitBytes - abort past this size.
 * @returns the decoded body.
 */
export async function readBody(req, limitBytes) {
  const limit = Number.isFinite(limitBytes) ? limitBytes : 4_000_000;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    size += buf.length;
    if (size > limit) throw new Error('request body too large');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Pick the provider/model route for a rewrite.
 *
 * Precedence: explicit config → the deployment's agent default model → the
 * first route an adapter actually advertises a model for.
 *
 * @param ctx - host context.
 * @param config - normalised settings.
 * @returns a route, or `null` when nothing is usable.
 */
export async function resolveRoute(ctx, config) {
  if (config.provider !== '' && config.model !== '') {
    return { provider: config.provider, model: config.model };
  }
  const soft = (key) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(key) : undefined;
    } catch {
      return undefined;
    }
  };
  const defaults = soft('agentDefaultModel');
  if (defaults !== undefined && defaults !== null && typeof defaults.currentSelection === 'function') {
    try {
      const selection = defaults.currentSelection();
      if (
        selection !== null &&
        typeof selection === 'object' &&
        typeof selection.provider === 'string' &&
        selection.provider !== '' &&
        typeof selection.model === 'string' &&
        selection.model !== ''
      ) {
        return { provider: selection.provider, model: selection.model };
      }
    } catch {
      // A broken default model must not stop discovery.
    }
  }
  const llm = soft('llm');
  if (llm === undefined || llm === null || typeof llm.listProviders !== 'function') return null;
  let providers;
  try {
    providers = llm.listProviders();
  } catch {
    return null;
  }
  if (!Array.isArray(providers)) return null;
  for (const provider of providers) {
    const id = provider !== null && typeof provider === 'object' ? provider.id : undefined;
    if (typeof id !== 'string' || id === '') continue;
    try {
      const models = await llm.listModels(id);
      if (Array.isArray(models) && models.length > 0 && typeof models[0].id === 'string' && models[0].id !== '') {
        return { provider: id, model: models[0].id };
      }
    } catch {
      // An adapter that cannot enumerate models is simply skipped.
    }
  }
  return null;
}

/**
 * Stream one rewrite and return the joined text.
 *
 * Terminal `finish` reasons other than `stop` become thrown errors carrying the
 * provider-neutral failure code, so the route can report `NO_ADAPTER`,
 * `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED` … verbatim.
 *
 * @param llm - the `llm` service.
 * @param route - provider and model.
 * @param system - system prompt.
 * @param user - user message text.
 * @param config - normalised settings.
 * @returns the model's raw text.
 */
export async function streamRewrite(llm, route, system, user, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* already settled */
    }
  }, config.timeoutMs);
  let text = '';
  let finish = null;
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      ...(typeof config.reasoningEffort === 'string' && config.reasoningEffort !== ''
        ? { reasoningEffort: config.reasoningEffort }
        : {}),
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue;
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text;
      } else if (chunk.type === 'finish') {
        finish = chunk.reason === undefined ? null : chunk.reason;
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (finish !== null && typeof finish === 'object' && finish.kind !== undefined && finish.kind !== 'stop') {
    const failure = finish.failure !== null && typeof finish.failure === 'object' ? finish.failure : {};
    const error = new Error(
      typeof failure.message === 'string' && failure.message !== ''
        ? failure.message
        : `model finished with "${String(finish.kind)}"`,
    );
    error.code = typeof failure.code === 'string' && failure.code !== '' ? failure.code : String(finish.kind).toUpperCase();
    // Keep what already streamed: a truncated answer is still worth shipping.
    error.partialText = text;
    throw error;
  }
  return text;
}

/** Normalise any thrown value into a wire-safe `{ code, message }`. */
function failureOf(error) {
  const code =
    error !== null && typeof error === 'object' && typeof error.code === 'string' && error.code !== ''
      ? error.code
      : error !== null && typeof error === 'object' && error.name === 'AbortError'
        ? 'ABORTED'
        : 'OPTIMIZE_FAILED';
  const message =
    error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== ''
      ? error.message
      : String(error);
  return { code, message };
}

/**
 * Run one optimisation: model first, deterministic envelope second.
 *
 * @param ctx - host context.
 * @param config - normalised settings.
 * @param text - the user's draft.
 * @param style - flavour override for this request (optional).
 * @param preset - output shape override for this request (optional).
 * @returns `{ text, engine, route, ms, warning? }`.
 */
export async function optimize(ctx, config, text, style, preset) {
  const started = Date.now();
  const flavour = STYLES.has(style) ? style : config.style;
  const shape = PRESETS.has(preset) ? preset : config.preset;
  const structured = shape !== 'native';
  // Both shapes need real room: a task card is ~800–1100 Chinese characters and
  // a hardened brief is ~300–500, but the adapter bills thinking tokens against
  // the same ceiling. 1600 was leaving nothing for the answer.
  const budget = structured ? Math.max(config.maxTokens, 8000) : Math.max(config.maxTokens, 4000);
  let request = budget === config.maxTokens ? config : { ...config, maxTokens: budget };
  let warning = null;
  let llm;
  try {
    llm = typeof ctx.get === 'function' ? ctx.get('llm') : undefined;
  } catch {
    llm = undefined;
  }
  if (llm !== undefined && llm !== null && typeof llm.stream === 'function') {
    const system = buildSystemPrompt(flavour, config.styleHint, shape);
    const user = buildUserPrompt(text, shape);
    let route = await resolveRoute(ctx, config);
    for (let attempt = 0; attempt < 2 && route !== null; attempt += 1) {
      try {
        const raw = await streamRewrite(llm, route, system, user, request);
        const clean = sanitizeOutput(raw);
        if (clean !== '' && isThin(clean, shape)) {
          // One repair pass: flash-class models like answering a request for a
          // brief with a single sentence. Ask again with the bill of materials.
          let expanded = '';
          try {
            expanded = sanitizeOutput(await streamRewrite(llm, route, system, buildExpandPrompt(text, shape, clean), request));
          } catch (repairError) {
            expanded = '';
          }
          if (expanded !== '' && !isThin(expanded, shape)) {
            return {
              text: expanded,
              engine: 'llm',
              route,
              ms: Date.now() - started,
              warning: { code: 'EXPANDED', message: '模型第一版太短，已重锻一次' },
            };
          }
          warning = { code: 'THIN_OUTPUT', message: '模型把多条要求压成一句话，改用本地兜底' };
          break;
        }
        if (clean !== '') {
          return { text: clean, engine: 'llm', route, ms: Date.now() - started };
        }
        warning = { code: 'EMPTY_OUTPUT', message: '模型没有输出任何内容' };
        break;
      } catch (error) {
        warning = failureOf(error);
        // Truncated but non-empty: ship what arrived instead of dropping a
        // 12-second answer on the floor and falling back to the envelope.
        const partial = typeof error === 'object' && error !== null && typeof error.partialText === 'string' ? sanitizeOutput(error.partialText) : '';
        if (warning.code === 'MAX_TOKENS' && partial !== '') {
          return {
            text: partial,
            engine: 'llm',
            route,
            ms: Date.now() - started,
            warning: { code: 'TRUNCATED', message: '模型输出撞到长度上限，已交付截断前的部分' },
          };
        }
        // An adapter that does not advertise this thinking budget rejects the
        // call outright; retry once without the hint rather than losing the run.
        if (request.reasoningEffort !== undefined && /REASONING|UNSUPPORTED/i.test(warning.code)) {
          request = { ...request, reasoningEffort: undefined };
          warning = null;
          continue;
        }
        // A stale route is worth exactly one rediscovery.
        const discovered = warning.code === 'NO_ADAPTER' && attempt === 0 ? await resolveRoute(ctx, { ...config, provider: '', model: '' }) : null;
        if (discovered === null || (discovered.provider === route.provider && discovered.model === route.model)) {
          route = null;
        } else {
          route = discovered;
        }
      }
    }
    if (route === null && warning === null) warning = { code: 'NO_ROUTE', message: '没有可用的模型路由' };
  } else {
    warning = { code: 'NO_LLM', message: '宿主没有可用的 llm 服务' };
  }
  if (structured) {
    // Boundary: a Trellis task card cannot be produced by the deterministic
    // envelope, and a fake structure is worse than a clear error.
    const error = new Error(
      `Trellis 任务书必须由模型生成，当前模型路由不可用（${warning === null ? 'UNKNOWN' : warning.code}）：${warning === null ? '' : warning.message}`,
    );
    error.code = 'PRESET_NEEDS_MODEL';
    throw error;
  }
  if (!config.localFallback) {
    const error = new Error(warning === null ? '优化失败' : warning.message);
    error.code = warning === null ? 'OPTIMIZE_FAILED' : warning.code;
    throw error;
  }
  return { text: hardenLocally(text), engine: 'local', route: null, ms: Date.now() - started, warning };
}

/**
 * Plugin body: mount the HTTP surface the composer button talks to.
 *
 * @param ctx - host root context.
 * @param config - optional Loader-row config.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config);
  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger !== null && logger !== undefined && typeof logger[level] === 'function') logger[level](message);
    } catch {
      /* logging must never break the mount */
    }
  };
  let inFlight = 0;

  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(typeof req.url === 'string' ? req.url : '/', 'http://localhost');
    } catch {
      return sendJson(res, 400, { ok: false, error: { code: 'BAD_URL', message: '无法解析请求地址' } });
    }
    const route = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+|\/+$/g, '');
    try {
      if (req.method === 'GET' && (route === '' || route === 'health')) {
        return sendJson(res, 200, {
          ok: true,
          plugin: name,
          version: VERSION,
          style: settings.style,
          styles: [...STYLES],
          preset: settings.preset,
          presets: [...PRESET_IDS],
          localFallback: settings.localFallback,
        });
      }
      if (req.method !== 'POST' || route !== 'optimize') {
        return sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `未知路由: ${route}` } });
      }
      if (inFlight >= settings.maxConcurrent) {
        return sendJson(res, 429, { ok: false, error: { code: 'BUSY', message: '同时锻造的人太多了，稍后再来' } });
      }
      let payload;
      try {
        payload = JSON.parse((await readBody(req)) || '{}');
      } catch (error) {
        return sendJson(res, 400, { ok: false, error: { code: 'BAD_JSON', message: String(error && error.message ? error.message : error) } });
      }
      const text = payload !== null && typeof payload === 'object' && typeof payload.text === 'string' ? payload.text : '';
      if (text.trim() === '') {
        return sendJson(res, 400, { ok: false, error: { code: 'EMPTY_INPUT', message: '输入框是空的，没东西可锻' } });
      }
      if (text.length > settings.maxInputChars) {
        return sendJson(res, 413, {
          ok: false,
          error: { code: 'INPUT_TOO_LONG', message: `输入太长了（${text.length} 字，上限 ${settings.maxInputChars} 字）` },
        });
      }
      inFlight += 1;
      try {
        const usedStyle = STYLES.has(payload.style) ? payload.style : settings.style;
        const usedPreset = PRESETS.has(payload.preset) ? payload.preset : settings.preset;
        const result = await optimize(ctx, settings, text, usedStyle, usedPreset);
        return sendJson(res, 200, { ok: true, style: usedStyle, preset: usedPreset, ...result });
      } finally {
        inFlight -= 1;
      }
    } catch (error) {
      const failure = failureOf(error);
      log('warn', `${name}: optimize failed: ${failure.code} ${failure.message}`);
      return sendJson(res, 502, { ok: false, error: failure });
    }
  };

  const mount = () => {
    const registration = ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
    return () => {
      try {
        if (typeof registration === 'function') registration();
      } catch {
        /* already disposed */
      }
    };
  };

  try {
    if (typeof ctx.effect === 'function') ctx.effect(mount, `${name}: HTTP surface`);
    else mount();
    log('info', `${name}: 已挂载 ${ROUTE_PREFIX}（style=${settings.style}, fallback=${settings.localFallback}）`);
  } catch (error) {
    log('warn', `${name}: 挂载 HTTP 面失败: ${String(error)}`);
  }
}

/** Offline-test surface; the Loader reads only `name`, `inject`, and `apply`. */
export const __internals = {
  ROUTE_PREFIX,
  VERSION,
  DEFAULTS,
  STYLES,
  PRESETS,
  PRESET_IDS,
  PRESET_SKELETONS,
  isThin,
  buildExpandPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  hardenLocally,
  sanitizeOutput,
  normalizeConfig,
  resolveRoute,
  streamRewrite,
  optimize,
  sendJson,
  readBody,
};
