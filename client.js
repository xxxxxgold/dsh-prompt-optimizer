/**
 * dsh-prompt-optimizer — client half (web bundle).
 *
 * One compact control in the composer's tool row (`conversation.input.left`):
 *
 *   click → a small menu opens with the three flavours (`hard` / `team` /
 *           `cool`); picking one sends the draft to this package's host half,
 *           forges it in that voice, and writes the result straight back into
 *           the editor via the composer's own `inputActions.setDraft`.
 *
 * The flavour therefore lives where the click happens, not in the deployment
 * config: `config.style` stays as the remembered/fallback default only.
 *
 * ## Bundle shape
 *
 * A DSH web client module in the shipped format: the manifest declares
 * `dsh.client = { platform: 'web', … }`, `exports['./client']` points here, and
 * the client module system loads it with
 * `window.__ModuleLoader__.load({ id, factory })`. `id` is the package name and
 * `factory(require)` resolves `react` / `react/jsx-runtime` from the shared
 * module table — no build step, no other dependency.
 *
 * ## Where the draft comes from
 *
 * The composer slot hands every entry its standard props; two of them are the
 * whole contract this button needs:
 *
 *   - `useInput(selector)` — snapshot hook over the session's `InputState`;
 *     `state.draft` is the live editor text.
 *   - `inputActions.setDraft(text)` — replace the whole draft (what the
 *     shipped code itself calls to restore a persisted draft).
 *
 * Nothing here reaches into the DOM or the editor instance: the button renders,
 * the composer owns the text.
 *
 * ## Failure posture
 *
 * Every path degrades to a visible, harmless state: no draft → the button is
 * disabled; a route error → a short red note with the host's reason; the host
 * itself answers `engine: 'local'` when no model route works, so the user still
 * gets a hardened prompt instead of an error.
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-optimizer',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const jsxRuntime = require('react/jsx-runtime');
    const jsx = jsxRuntime.jsx;
    const jsxs = jsxRuntime.jsxs;

    /** Locale namespace owned by this plugin. */
    const NS = 'prompt-optimizer';
    /** Host route the button talks to (same origin). */
    const ENDPOINT = '/dsh-prompt-optimizer/optimize';
    /** Where the picker asks which thinking efforts the current model offers. */
    const MODEL_ENDPOINT = '/dsh-prompt-optimizer/model';
    /** Where the picker asks which forge models the host can offer. */
    const MODELS_ENDPOINT = '/dsh-prompt-optimizer/models';
    /** Registry id of this composer entry. */
    const ENTRY_ID = 'dsh-prompt-optimizer:hard-forge';
    /** Stylesheet identity, tagged like every shipped client bundle stylesheet. */
    const CSS_TAG = 'dsh-prompt-optimizer/HardForge.css';

    // ---------------------------------------------------------------------
    // Flavour choice — lives on the button, remembered between clicks
    // ---------------------------------------------------------------------
    /** The three flavours the host understands, in menu order. */
    const STYLE_IDS = ['hard', 'team', 'cool'];

    /** Where the last used flavour is remembered. */
    const STYLE_STORAGE_KEY = 'dsh-prompt-optimizer:style';

    /** Read the remembered flavour; anything unreadable falls back to `hard`. */
    function readStoredStyle() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return 'hard';
        const saved = localStorage.getItem(STYLE_STORAGE_KEY);
        return STYLE_IDS.indexOf(saved) === -1 ? 'hard' : saved;
      } catch {
        return 'hard';
      }
    }

    /** The output shapes the host understands, in menu order. */
    const PRESET_IDS = ['native', 'feat', 'issue', 'refactor'];

    /** Where the last used output shape is remembered. */
    const PRESET_STORAGE_KEY = 'dsh-prompt-optimizer:preset';

    /** Read the remembered shape; anything unreadable falls back to `native`. */
    function readStoredPreset() {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return 'native';
        const saved = localStorage.getItem(PRESET_STORAGE_KEY);
        return PRESET_IDS.indexOf(saved) === -1 ? 'native' : saved;
      } catch {
        return 'native';
      }
    }

    /** Remember the chosen shape; blocked storage costs memory, never the run. */
    function rememberPreset(shape) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        localStorage.setItem(PRESET_STORAGE_KEY, shape);
      } catch {
        /* quota or privacy mode - the current run still uses the picked shape */
      }
    }

    /** Remember the chosen flavour; blocked storage costs memory, never the run. */
    function rememberStyle(flavour) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        localStorage.setItem(STYLE_STORAGE_KEY, flavour);
      } catch {
        /* quota or privacy mode — the current run still uses the picked flavour */
      }
    }

    // ---------------------------------------------------------------------
    // Forge model + thinking strength — remembered between visits
    // ---------------------------------------------------------------------
    /** Where the picked forge model is remembered. */
    const MODEL_STORAGE_KEY = 'dsh-prompt-optimizer:model';

    /** Where the lock snapshot lives. Presence means "locked". */
    const LOCK_STORAGE_KEY = 'dsh-prompt-optimizer:lock';

    /** Per-model effort memory prefix; the model id is appended. */
    const EFFORT_STORAGE_PREFIX = 'dsh-prompt-optimizer:effort:';

    /** Read one JSON object; anything missing or malformed reads as null. */
    function readStoredJson(key) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return null;
        const raw = localStorage.getItem(key);
        if (typeof raw !== 'string' || raw === '') return null;
        const parsed = JSON.parse(raw);
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }

    /** Write one JSON object; blocked storage costs memory, never the run. */
    function writeStoredJson(key, value) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota or privacy mode — the current run still uses the value */
      }
    }

    /** Remove one key; a blocked storage is already as empty as it gets. */
    function removeStored(key) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        localStorage.removeItem(key);
      } catch {
        /* nothing to remove */
      }
    }

    /** Read the remembered forge model; `manual` says the user picked it. */
    function readStoredModel() {
      const value = readStoredJson(MODEL_STORAGE_KEY);
      if (
        value === null ||
        typeof value.provider !== 'string' ||
        value.provider === '' ||
        typeof value.model !== 'string' ||
        value.model === ''
      ) {
        return null;
      }
      return { provider: value.provider, model: value.model, manual: value.manual === true };
    }

    /** Remember the forge model; `manual` means "do not follow the current one". */
    function rememberModel(selection) {
      if (
        selection === null ||
        typeof selection !== 'object' ||
        typeof selection.provider !== 'string' ||
        selection.provider === '' ||
        typeof selection.model !== 'string' ||
        selection.model === ''
      ) {
        return;
      }
      writeStoredJson(MODEL_STORAGE_KEY, {
        provider: selection.provider,
        model: selection.model,
        manual: selection.manual === true,
      });
    }

    /** Read the lock snapshot; null means the plugin is unlocked. */
    function readStoredLock() {
      const value = readStoredJson(LOCK_STORAGE_KEY);
      if (
        value === null ||
        typeof value.provider !== 'string' ||
        value.provider === '' ||
        typeof value.model !== 'string' ||
        value.model === ''
      ) {
        return null;
      }
      return {
        provider: value.provider,
        model: value.model,
        effort: typeof value.effort === 'string' ? value.effort : '',
      };
    }

    /** Store the frozen model + effort. */
    function rememberLock(snapshot) {
      if (
        snapshot === null ||
        typeof snapshot !== 'object' ||
        typeof snapshot.provider !== 'string' ||
        snapshot.provider === '' ||
        typeof snapshot.model !== 'string' ||
        snapshot.model === ''
      ) {
        return;
      }
      writeStoredJson(LOCK_STORAGE_KEY, {
        provider: snapshot.provider,
        model: snapshot.model,
        effort: typeof snapshot.effort === 'string' ? snapshot.effort : '',
      });
    }

    /** Drop the lock snapshot, keeping the current model + effort in place. */
    function clearStoredLock() {
      removeStored(LOCK_STORAGE_KEY);
    }

    /** One model's remembered effort key. */
    function effortStorageKey(provider, model) {
      return EFFORT_STORAGE_PREFIX + encodeURIComponent(String(provider)) + '/' + encodeURIComponent(String(model));
    }

    /** Read the last effort picked for this model; empty when never picked. */
    function readStoredEffort(provider, model) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return '';
        const value = localStorage.getItem(effortStorageKey(provider, model));
        return typeof value === 'string' ? value : '';
      } catch {
        return '';
      }
    }

    /** Remember the effort picked for this model. */
    function rememberEffort(provider, model, effort) {
      try {
        if (typeof localStorage === 'undefined' || localStorage === null) return;
        const key = effortStorageKey(provider, model);
        if (typeof effort === 'string' && effort !== '') localStorage.setItem(key, effort);
        else localStorage.removeItem(key);
      } catch {
        /* quota or privacy mode — the current run still uses the effort */
      }
    }

    // ---------------------------------------------------------------------
    // Dictionaries
    // ---------------------------------------------------------------------
    /**
     * The one visible string on the button. Pinned verbatim — never translated,
     * never re-cased, never prefixed: the ♂ is part of the label.
     */
    const LABEL = '♂harden';
    const zh = {
      'button.idle': LABEL,
      'button.busy': LABEL,
      'button.done': LABEL,
      'button.error': LABEL,
      'button.title': '点一下选口味与规范：口味 硬汉/肌肉集团/雷霆炫酷，规范 原生/需求/缺陷/重构',
      'button.titleBusy': '正在锻造，别催，马上给你硬的',
      'button.forge': '开锻',
      'effort.label': '思考强度',
      'effort.hint': '这一档思考强度会随请求一起发出去，默认取该模型上一次的设定',
      'effort.default': '默认跟随模型',
      'effort.fromStored': '上次设定',
      'effort.fromModel': '模型默认',
      'effort.fromFallback': '首个挡位',
      'model.label': '模型',
      'model.lock': '锁定',
      'model.locked': '已锁定',
      'model.lockHint': '锁定当前模型与思考强度，锁定后不再变动',
      'model.unlockHint': '解锁后可以重新选择模型与思考强度',
      'model.current': '当前模型',
      'model.empty': '没有可用模型',
      'style.hard': '硬汉',
      'style.team': '肌肉集团',
      'style.cool': '雷霆炫酷',
      'style.hard.hint': '硬汉直给：短句命令式，强度词管够',
      'style.team.hint': '肌肉集团：拆成能并行的块，各干各的再拼装',
      'style.cool.hint': '雷霆炫酷：拉爆、榨干、细节拉满',
      'preset.native': '原生',
      'preset.feat': '需求',
      'preset.issue': '缺陷',
      'preset.refactor': '重构',
      'preset.native.hint': '原生：一句话硬邦邦提示词，选完直接发',
      'preset.feat.hint': '需求：Trellis feat 任务书，prd→design→impl→review→check',
      'preset.issue.hint': '缺陷：Trellis issue 报告，report→analyze→fix→fix-note',
      'preset.refactor.hint': '重构：Trellis refactor 扫描，scan→design→apply→done',
      'state.empty': '输入框是空的，先写点东西哥们',
      'state.inputTooLong': '太长了，超过上限，砍短点再来',
      'state.busy': '同时锻造的人太多，等两秒再点',
      'state.network': '连不上宿主，锻造炉没点着火',
      'state.badResponse': '宿主回了一句看不懂的话',
      'state.doneLlm': '已锻造 · 模型出手',
      'state.doneLocal': '已锻造 · 本地兜底',
      'state.aborted': '收工了，没锻',
    };
    const en = {
      'button.idle': LABEL,
      'button.busy': LABEL,
      'button.done': LABEL,
      'button.error': LABEL,
      'button.title': 'Pick a flavour and a shape — hard/team/cool · plain/feat/issue/refactor',
      'button.titleBusy': 'Forging — hold on, it will come out hard',
      'button.forge': 'Forge',
      'effort.label': 'Thinking',
      'effort.hint': 'Sent with the request; defaults to the last effort picked for this model',
      'effort.default': 'model default',
      'effort.fromStored': 'last picked',
      'effort.fromModel': 'model default',
      'effort.fromFallback': 'first option',
      'model.label': 'Model',
      'model.lock': 'Lock',
      'model.locked': 'Locked',
      'model.lockHint': 'Lock the current model and thinking effort; neither will change',
      'model.unlockHint': 'Unlock to pick a different model or thinking effort',
      'model.current': 'current model',
      'model.empty': 'no models available',
      'style.hard': 'hard',
      'style.team': 'team',
      'style.cool': 'cool',
      'style.hard.hint': 'Hard-boiled: clipped commands, plenty of force',
      'style.team.hint': 'Muscle crew: split into parallel chunks, then bolt together',
      'style.cool.hint': 'Thunder-cool: crank it up, wring it out, every detail',
      'preset.native': 'plain',
      'preset.feat': 'feat',
      'preset.issue': 'issue',
      'preset.refactor': 'refactor',
      'preset.native.hint': 'Plain: one hardened paragraph, ready to send',
      'preset.feat.hint': 'Feat: Trellis feat task card, prd→design→impl→review→check',
      'preset.issue.hint': 'Issue: Trellis issue report, report→analyze→fix→fix-note',
      'preset.refactor.hint': 'Refactor: Trellis refactor scan, scan→design→apply→done',
      'state.empty': 'The input is empty — write something first, buddy',
      'state.inputTooLong': 'Too long for the forge; trim it and try again',
      'state.busy': 'Too many people forging right now — try again in a second',
      'state.network': 'Cannot reach the host — the forge did not light up',
      'state.badResponse': 'The host answered something unreadable',
      'state.doneLlm': 'Hardened · model strike',
      'state.doneLocal': 'Hardened · local fallback',
      'state.aborted': 'Stopped, nothing forged',
    };

    // ---------------------------------------------------------------------
    // Stylesheet — injected once, removed with the plugin.
    // ---------------------------------------------------------------------
    const CSS = [
      '.dshPo_root{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%}',
      // ---- the pill: frosted hot tint + a flowing masked gradient ring -----
      '.dshPo_btn{',
      '--dshPo-a:#ff6a00;--dshPo-b:#ff2d55;--dshPo-c:#a855f7;--dshPo-d:#ffc400;',
      '--dshPo-surface:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#1c1d21));',
      '--dshPo-tint:linear-gradient(135deg,rgba(255,106,0,.22),rgba(255,45,85,.15) 48%,rgba(168,85,247,.20));',
      '--dshPo-ring:linear-gradient(115deg,#ff6a00,#ff2d55 30%,#a855f7 62%,#ffc400 84%,#ff6a00);',
      'position:relative;isolation:isolate;display:inline-flex;align-items:center;justify-content:center;',
      'height:calc(24px + var(--dsh-content-font-delta,0px));padding:0 11px;border-radius:999px;',
      'border:1px solid transparent;',
      'background-image:var(--dshPo-tint),linear-gradient(var(--dshPo-surface),var(--dshPo-surface)),var(--dshPo-ring);',
      'background-origin:padding-box,padding-box,border-box;',
      'background-clip:padding-box,padding-box,border-box;',
      'background-size:100% 100%,100% 100%,300% 100%;',
      'background-position:0% 50%,0% 50%,0% 50%;',
      'animation:dshPoFlow 5.5s linear infinite;',
      'font:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-weight:600;letter-spacing:.25px;line-height:1;',
      'color:var(--dsw-alias-label-primary,inherit);white-space:nowrap;cursor:pointer;user-select:none;',
      'box-shadow:0 0 0 1px rgba(255,106,0,.10),0 1px 3px rgba(0,0,0,.14),0 0 12px rgba(255,90,0,.14);',
      'transition:transform .14s ease,box-shadow .22s ease,filter .22s ease}',
      // The ring is the third background layer, clipped to the border box; the
      // opaque raised surface under the tint hides everything but that 1px ring.
      // Motion + focus + the states that keep the pill alive while disabled.
      '.dshPo_btn:hover:not(:disabled){transform:translateY(-1px);filter:saturate(1.18) brightness(1.06);',
      'box-shadow:0 0 0 1px rgba(255,106,0,.42),0 5px 18px rgba(255,45,85,.34),0 0 26px rgba(168,85,247,.26)}',
      '.dshPo_btn:active:not(:disabled){transform:translateY(0) scale(.972);transition-duration:.05s}',
      '.dshPo_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff6a00);outline-offset:2px}',
      '.dshPo_btn:disabled{opacity:.55;cursor:not-allowed}',
      // The label is the whole mark; z-index keeps it above the gloss sweep.
      '.dshPo_label{position:relative;z-index:1;display:inline-block}',
      '@supports ((-webkit-background-clip:text) or (background-clip:text)){',
      '.dshPo_btn .dshPo_label{background-image:linear-gradient(100deg,#ff6a00,#ff2d55 34%,#a855f7 68%,#ffc400);',
      'background-size:220% 100%;background-position:0% 50%;-webkit-background-clip:text;background-clip:text;',
      '-webkit-text-fill-color:transparent;color:transparent;animation:dshPoTextFlow 4.2s linear infinite}}',
      // Gloss sweep: a skewed highlight, always on hover, relentless while busy.
      '.dshPo_shine{position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;z-index:0}',
      '.dshPo_shine::after{content:"";position:absolute;top:-20%;bottom:-20%;left:-60%;width:45%;transform:skewX(-18deg);',
      'background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);opacity:0;transition:opacity .18s ease}',
      '.dshPo_btn:hover:not(:disabled) .dshPo_shine::after{opacity:1;animation:dshPoSweep 1.5s ease-in-out infinite}',
      // busy: faster ring, pulsing halo, constant sweep, still on-brand.
      '.dshPo_btn[data-phase=busy]{opacity:1;cursor:progress;',
      '--dshPo-ring:linear-gradient(115deg,#ffb020,#ff3b30 28%,#ffd60a 58%,#ff8a00);',
      '--dshPo-tint:linear-gradient(135deg,rgba(255,176,32,.26),rgba(255,59,48,.18));',
      'animation:dshPoFlow 1.15s linear infinite,dshPoPulse 1.5s ease-in-out infinite}',
      '.dshPo_btn[data-phase=busy] .dshPo_shine::after{opacity:1;animation:dshPoSweep .95s linear infinite}',
      '.dshPo_btn[data-phase=busy] .dshPo_label{animation-duration:1.6s}',
      // The marquee: a second, tighter ring orbits the border while busy. It is
      // a masked conic gradient, so only the 1.5px edge paints; the angle is a
      // registered custom property, which keeps the animation compositor-cheap.
      '@property --dshPoAngle{syntax:"<angle>";initial-value:0deg;inherits:false}',
      '.dshPo_btn[data-phase=busy]::before{content:"";position:absolute;inset:-1.5px;border-radius:inherit;padding:1.5px;',
      'pointer-events:none;z-index:0;',
      'background:conic-gradient(from var(--dshPoAngle),transparent 0deg 36%,#ffb020 45%,#ff3b30 51%,transparent 60%,',
      'transparent 72%,#ffd60a 81%,#ff8a00 88%,transparent 96%);',
      '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;',
      'mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;',
      'animation:dshPoOrbit 1.05s linear infinite}',
      // done: teal-green ring, one happy pop, lasting glow.
      '.dshPo_btn[data-phase=done]{opacity:1;--dshPo-ring:linear-gradient(115deg,#12b76a,#7ee2b8 45%,#0fbf7f);',
      '--dshPo-tint:linear-gradient(135deg,rgba(18,183,106,.22),rgba(126,226,184,.15));',
      'animation:dshPoFlow 2.6s linear infinite,dshPoPop .5s cubic-bezier(.2,1.5,.4,1) 1;',
      'box-shadow:0 0 0 1px rgba(18,183,106,.40),0 3px 14px rgba(18,183,106,.34),0 0 22px rgba(18,183,106,.24)}',
      '.dshPo_btn[data-phase=done] .dshPo_label{background-image:linear-gradient(100deg,#0fbf7f,#12b76a 48%,#7ee2b8)}',
      // error: ember ring, one shake, no endless blinking.
      '.dshPo_btn[data-phase=error]{opacity:1;--dshPo-ring:linear-gradient(115deg,#f04438,#ff7a59 45%,#ffb020);',
      '--dshPo-tint:linear-gradient(135deg,rgba(240,68,56,.24),rgba(255,122,89,.15));',
      'animation:dshPoShake .42s ease-in-out 1;',
      'box-shadow:0 0 0 1px rgba(240,68,56,.44),0 3px 14px rgba(240,68,56,.34),0 0 22px rgba(240,68,56,.24)}',
      '.dshPo_btn[data-phase=error] .dshPo_label{background-image:linear-gradient(100deg,#f04438,#ff7a59 55%,#ffb020)}',
      // Motion.
      '@keyframes dshPoFlow{from{background-position:0% 50%,0% 50%,0% 50%}to{background-position:0% 50%,0% 50%,100% 50%}}',
      '@keyframes dshPoTextFlow{from{background-position:0% 50%}to{background-position:100% 50%}}',
      '@keyframes dshPoSweep{from{left:-60%}to{left:120%}}',
      '@keyframes dshPoOrbit{to{--dshPoAngle:360deg}}',
      '@keyframes dshPoPulse{0%,100%{box-shadow:0 0 0 1px rgba(255,140,0,.40),0 0 12px rgba(255,90,0,.28)}',
      '50%{box-shadow:0 0 0 1px rgba(255,196,0,.55),0 0 26px rgba(255,120,0,.50)}}',
      '@keyframes dshPoPop{0%{transform:scale(.90)}55%{transform:scale(1.07)}100%{transform:scale(1)}}',
      '@keyframes dshPoShake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}',
      '60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}',
      // Flavour picker: opens upward from the pill, three chips in ONE row.
      '.dshPo_root{position:relative}',
      '.dshPo_pick{position:absolute;bottom:calc(100% + 6px);left:0;z-index:40;display:flex;flex-direction:column;gap:6px;',
      'align-items:stretch;width:max-content;max-width:min(94vw,560px);overflow:visible;padding:8px;border-radius:10px;',
      'border:1px solid rgba(255,255,255,.08);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,#1c1d21));',
      'box-shadow:0 6px 18px rgba(0,0,0,.22)}',
      '.dshPo_chip{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;height:26px;padding:0 9px;border-radius:6px;',
      'border:1px solid transparent;background:transparent;font:inherit;font-size:12px;font-weight:600;letter-spacing:.2px;white-space:nowrap;cursor:pointer;',
      'color:var(--dsw-alias-label-primary,inherit);transition:background .12s ease,border-color .12s ease}',
      '.dshPo_chip:hover{background:rgba(255,106,0,.10);border-color:rgba(255,106,0,.24)}',
      '.dshPo_chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff6a00);outline-offset:1px}',
      '.dshPo_chip[data-active=true]{background:rgba(255,106,0,.16);border-color:rgba(255,106,0,.52)}',
      '.dshPo_chipName{font-size:12px;font-weight:600;letter-spacing:.2px}',
      '.dshPo_row{display:flex;flex-direction:row;flex-wrap:nowrap;gap:4px;align-items:center}',
      '.dshPo_sep{flex:0 0 auto;width:1px;align-self:stretch;margin:2px 2px;border-radius:1px;background:rgba(255,255,255,.10)}',
      '.dshPo_rowLabel{flex:0 0 auto;font-size:11px;opacity:.55;letter-spacing:.3px}',
      '.dshPo_modelRow{width:100%;gap:6px}',
      '.dshPo_select{flex:1 1 auto;min-width:140px;max-width:340px;height:26px;padding:0 6px;border-radius:6px;',
      'border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);',
      'color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px;cursor:pointer}',
      '.dshPo_select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff6a00);outline-offset:1px}',
      '.dshPo_select:disabled{opacity:.5;cursor:not-allowed}',
      '.dshPo_effortChips{display:flex;flex:0 1 auto;gap:4px;align-items:center}',
      '.dshPo_effortChips .dshPo_chip{height:24px;padding:0 8px;font-size:11px}',
      '.dshPo_lockWrap{display:inline-flex;align-items:center;gap:4px;flex:0 0 auto}',
      '.dshPo_lockLabel{font-size:11px;opacity:.55;white-space:nowrap}',
      '.dshPo_switch{position:relative;flex:0 0 auto;width:30px;height:16px;padding:0;border-radius:999px;border:1px solid rgba(255,255,255,.16);',
      'background:rgba(255,255,255,.10);cursor:pointer;transition:background .16s ease,border-color .16s ease}',
      '.dshPo_switch::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#fff;transition:transform .16s ease}',
      '.dshPo_switch[data-locked=true]{background:rgba(255,106,0,.85);border-color:rgba(255,106,0,.9)}',
      '.dshPo_switch[data-locked=true]::after{transform:translateX(14px)}',
      '.dshPo_switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#ff6a00);outline-offset:1px}',
      '.dshPo_switch:disabled{opacity:.5;cursor:not-allowed}',
      '.dshPo_go{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:34px;padding:0 12px;',
      'border-radius:8px;border:0;cursor:pointer;font:inherit;font-size:13px;font-weight:700;',
      'color:#fff;background:linear-gradient(90deg,#ff6a00,#ff2d55);box-shadow:none}',
      '.dshPo_go:hover:not(:disabled){filter:brightness(1.04)}',
      '.dshPo_go:disabled{opacity:.5;cursor:not-allowed}',
      '.dshPo_goHint{font-weight:400;opacity:.8;font-size:11px}',
      // The transient one-line result note beside the pill.
      '.dshPo_note{font-size:var(--dsh-content-font-size-caption,12px);color:var(--dsw-alias-label-tertiary,inherit);',
      'max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshPo_note[data-phase=error]{color:var(--dsw-alias-state-error-primary,#f04438)}',
      '.dshPo_visuallyHidden{clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}',
      // Accessibility gates: nothing moves for reduced motion, and forced-colors
      // gets a plain system pill instead of an unreadable gradient.
      '@media (prefers-reduced-motion:reduce){.dshPo_btn,.dshPo_btn .dshPo_label,.dshPo_shine::after,.dshPo_btn[data-phase=busy]::before',
      '{animation:none!important;transition:none!important}',
      '.dshPo_btn:hover:not(:disabled){transform:none}.dshPo_shine::after{opacity:0!important}}',
      '@media (forced-colors:active){.dshPo_btn{background:ButtonFace;border-color:ButtonBorder;color:ButtonText;',
      'box-shadow:none;animation:none}',
      '.dshPo_btn .dshPo_label{background-image:none;-webkit-text-fill-color:ButtonText;color:ButtonText}',
      '.dshPo_btn .dshPo_shine{display:none}}',
    ].join('');

    /**
     * No separate glyph: the visible mark *is* the label `♂harden`, so the
     * button carries exactly one string and no decorative extras.
     */

    // ---------------------------------------------------------------------
    // Helpers (exported for the offline tests)
    // ---------------------------------------------------------------------

    /** Plain-text reader for whatever a fetch answer or an unknown failure gives. */
    function textOf(value) {
      if (typeof value === 'string') return value;
      if (value !== null && typeof value === 'object' && typeof value.message === 'string') return value.message;
      return String(value);
    }

    /**
     * Map one host answer onto the button's result.
     *
     * @param response - parsed JSON body (may be anything).
     * @param status - HTTP status.
     * @returns `{ ok, text?, engine?, error? }` with a wire-safe shape.
     */
    function readResult(response, status) {
      if (response !== null && typeof response === 'object') {
        if (response.ok === true && typeof response.text === 'string' && response.text.trim() !== '') {
          return { ok: true, text: response.text, engine: response.engine === 'local' ? 'local' : 'llm' };
        }
        const error = response.error !== null && typeof response.error === 'object' ? response.error : null;
        if (error !== null) {
          return { ok: false, error: { code: typeof error.code === 'string' ? error.code : 'OPTIMIZE_FAILED', message: textOf(error.message) } };
        }
      }
      return { ok: false, error: { code: 'BAD_RESPONSE', message: 'HTTP ' + String(status) } };
    }

    /**
     * Parse the host's model description into `{ ok, effort, efforts }`.
     *
     * @param response - parsed JSON body (may be anything).
     * @param status - HTTP status.
     * @returns a shape the picker can render without further checks.
     */
    function readModel(response, status) {
      if (response === null || typeof response !== 'object' || response.ok !== true) {
        const error = response !== null && typeof response === 'object' && response.error !== null && typeof response.error === 'object' ? response.error : null;
        return { ok: false, effort: '', efforts: [], error: { code: error !== null && typeof error.code === 'string' ? error.code : 'MODEL_UNAVAILABLE', message: textOf(error !== null && error.message !== undefined ? error.message : 'HTTP ' + String(status)) } };
      }
      const efforts = Array.isArray(response.efforts)
        ? response.efforts
            .filter((item) => item !== null && typeof item === 'object' && typeof item.id === 'string' && item.id !== '')
            .map((item) => ({ id: item.id, name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id }))
        : [];
      return {
        ok: true,
        provider: typeof response.provider === 'string' ? response.provider : '',
        model: typeof response.model === 'string' ? response.model : '',
        effort: typeof response.effort === 'string' ? response.effort : '',
        efforts,
      };
    }

    /**
     * Parse the host's model catalog into `{ ok, current, models }`.
     *
     * @param response - parsed JSON body (may be anything).
     * @param status - HTTP status.
     * @returns a shape the picker can render without further checks.
     */
    function readModels(response, status) {
      if (response === null || typeof response !== 'object' || response.ok !== true) {
        const error = response !== null && typeof response === 'object' && response.error !== null && typeof response.error === 'object' ? response.error : null;
        return {
          ok: false,
          current: null,
          models: [],
          error: { code: error !== null && typeof error.code === 'string' ? error.code : 'MODELS_UNAVAILABLE', message: textOf(error !== null && error.message !== undefined ? error.message : 'HTTP ' + String(status)) },
        };
      }
      const current =
        response.current !== null &&
        typeof response.current === 'object' &&
        typeof response.current.provider === 'string' &&
        response.current.provider !== '' &&
        typeof response.current.model === 'string' &&
        response.current.model !== ''
          ? { provider: response.current.provider, model: response.current.model }
          : null;
      const models = Array.isArray(response.models)
        ? response.models
            .filter(
              (item) =>
                item !== null &&
                typeof item === 'object' &&
                typeof item.provider === 'string' &&
                item.provider !== '' &&
                typeof item.model === 'string' &&
                item.model !== '',
            )
            .map((item) => ({
              provider: item.provider,
              providerName: typeof item.providerName === 'string' && item.providerName !== '' ? item.providerName : item.provider,
              model: item.model,
              name: typeof item.name === 'string' && item.name !== '' ? item.name : item.model,
            }))
        : [];
      return { ok: true, current, models };
    }

    /**
     * Pick the effort one model should start on.
     *
     * First visit: the model's own default. Later visits: the last effort picked
     * for that model, but only while the model still advertises it. A model that
     * advertises no efforts yields an empty effort (and the row stays hidden).
     *
     * @param model - `{ efforts, effort }` from `readModel`.
     * @param stored - the effort last picked for this model, if any.
     * @returns `{ effort, source }` where source is `stored|model|fallback|none`.
     */
    function resolveEffort(model, stored) {
      const efforts = model !== null && typeof model === 'object' && Array.isArray(model.efforts) ? model.efforts : [];
      if (efforts.length === 0) return { effort: '', source: 'none' };
      const advertised = (id) =>
        typeof id === 'string' && id !== '' && efforts.some((item) => item !== null && typeof item === 'object' && item.id === id);
      if (advertised(stored)) return { effort: stored, source: 'stored' };
      if (advertised(model.effort)) return { effort: model.effort, source: 'model' };
      return { effort: efforts[0].id, source: 'fallback' };
    }

    /**
     * The request body for one forge. The flavour always travels with the call,
     * so the host never has to fall back to the deployment config. A picked
     * forge model travels as an explicit route override.
     */
    function postBody(text, flavour, preset, effort, locale, selection) {
      const picked = STYLE_IDS.indexOf(flavour) === -1 ? 'hard' : flavour;
      const shape = PRESET_IDS.indexOf(preset) === -1 ? 'native' : preset;
      const body = { text, style: picked, preset: shape };
      if (typeof effort === 'string' && effort !== '') body.reasoningEffort = effort;
      if (typeof locale === 'string' && locale !== '') body.locale = locale;
      if (
        selection !== null &&
        typeof selection === 'object' &&
        typeof selection.provider === 'string' &&
        selection.provider !== '' &&
        typeof selection.model === 'string' &&
        selection.model !== ''
      ) {
        body.provider = selection.provider;
        body.model = selection.model;
      }
      return body;
    }

    /** Locale lookup with a per-key fallback so one missing key never blanks the UI. */
    function translator(t) {
      const dict = typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.toLowerCase().startsWith('zh') ? zh : en;
      return (key) => {
        if (typeof t === 'function') {
          try {
            const value = t(key);
            if (typeof value === 'string' && value !== '' && value !== key) return value;
          } catch {
            /* fall through to the local dictionary */
          }
        }
        return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
      };
    }

    /** How long a transient result note stays on screen. */
    const NOTE_MS = { done: 2600, error: 6000 };

    // ---------------------------------------------------------------------
    // The button
    // ---------------------------------------------------------------------

    /**
     * Hook-owning body. Mounted only once the standard props exist, so the hook
     * count is stable for the lifetime of the entry.
     *
     * @param props - `useInput`, `inputActions`, and the locale translator `t`.
     */
    function HardForge({ useInput, inputActions, t }) {
      const translate = translator(t);
      const draft = useInput((state) =>
        state !== null && typeof state === 'object' && typeof state.draft === 'string' ? state.draft : '',
      );
      const [phase, setPhase] = react.useState('idle');
      const [note, setNote] = react.useState('');
      const [picking, setPicking] = react.useState(false);
      const [style, setStyle] = react.useState(() => readStoredStyle());
      const [preset, setPreset] = react.useState(() => readStoredPreset());
      // Thinking efforts come from the model itself, never from a fixed list.
      const [efforts, setEfforts] = react.useState([]);
      const [effort, setEffort] = react.useState('');
      const [models, setModels] = react.useState([]);
      const [selection, setSelection] = react.useState(() => readStoredModel());
      const [lockSnapshot, setLockSnapshot] = react.useState(() => readStoredLock());
      const abortRef = react.useRef(null);
      // The pill and its menu share one positioned root; the menu is a sibling
      // so the pill stays mounted (and keeps focus) while the menu is open.
      const rootRef = react.useRef(null);

      // Abandon one in-flight rewrite when the entry unmounts, and clear the
      // transient note timer so a settled state cannot be overwritten later.
      react.useEffect(() => {
        return () => {
          if (abortRef.current !== null) {
            try {
              abortRef.current.abort();
            } catch {
              /* already settled */
            }
            abortRef.current = null;
          }
        };
      }, []);

      react.useEffect(() => {
        if (phase !== 'done' && phase !== 'error') return undefined;
        const timer = setTimeout(() => {
          setPhase('idle');
          setNote('');
        }, phase === 'done' ? NOTE_MS.done : NOTE_MS.error);
        return () => clearTimeout(timer);
      }, [phase]);

      // Esc backs out of the flavour menu; clicking away is the pointer path.
      react.useEffect(() => {
        if (!picking) return undefined;
        const onKey = (event) => {
          if (event !== null && typeof event === 'object' && event.key === 'Escape') setPicking(false);
        };
        try {
          if (typeof document !== 'undefined' && document !== null && typeof document.addEventListener === 'function') {
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
          }
        } catch {
          /* no document: nothing to listen on */
        }
        return undefined;
      }, [picking]);

      // A click anywhere outside the control puts the menu away again: the pill
      // is one option, but clicking away is the reflex most people have.
      react.useEffect(() => {
        if (!picking) return undefined;
        const onDown = (event) => {
          const root = rootRef.current;
          const target = event !== null && typeof event === 'object' ? event.target : null;
          if (root !== null && root !== undefined && typeof root.contains === 'function' && target !== null && root.contains(target)) return;
          setPicking(false);
        };
        try {
          if (typeof document !== 'undefined' && document !== null && typeof document.addEventListener === 'function') {
            document.addEventListener('pointerdown', onDown);
            return () => document.removeEventListener('pointerdown', onDown);
          }
        } catch {
          /* no document: no outside clicks to observe */
        }
        return undefined;
      }, [picking]);

      const empty = typeof draft !== 'string' || draft.trim() === '';
      const busy = phase === 'busy';

      const loadModelDetail = react.useCallback(async (target) => {
        if (target !== null && typeof target !== 'object') return null;
        try {
          const url =
            target === null
              ? MODEL_ENDPOINT
              : MODEL_ENDPOINT +
                '?provider=' +
                encodeURIComponent(target.provider) +
                '&model=' +
                encodeURIComponent(target.model);
          const response = await fetch(url, { headers: { accept: 'application/json' } });
          let body = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          const model = readModel(body, response.status);
          return model.ok ? model : null;
        } catch {
          return null;
        }
      }, []);

      /** Apply one model description to the effort row. */
      const applyModelDetail = (detail, target, stored) => {
        setEfforts(detail.efforts);
        const resolved = resolveEffort(detail, stored);
        setEffort(resolved.effort);
      };

      // One read of the catalog on mount: which models the host offers, then
      // which efforts the chosen model advertises and which effort should start.
      react.useEffect(() => {
        let alive = true;
        (async () => {
          let catalog = null;
          try {
            const response = await fetch(MODELS_ENDPOINT, { headers: { accept: 'application/json' } });
            let body = null;
            try {
              body = await response.json();
            } catch {
              body = null;
            }
            const parsed = readModels(body, response.status);
            if (parsed.ok) catalog = parsed;
          } catch {
            /* no catalog: fall back to the model description alone */
          }
          if (!alive) return;
          if (catalog !== null) setModels(catalog.models);

          const snapshot = readStoredLock();
          const stored = readStoredModel();
          let target = null;
          let storedEffort = '';
          if (snapshot !== null) {
            target = { provider: snapshot.provider, model: snapshot.model, manual: true };
            storedEffort = snapshot.effort;
          } else if (stored !== null) {
            target = { provider: stored.provider, model: stored.model, manual: stored.manual === true };
            storedEffort = readStoredEffort(stored.provider, stored.model);
          } else if (catalog !== null && catalog.current !== null) {
            target = { provider: catalog.current.provider, model: catalog.current.model, manual: false };
            storedEffort = readStoredEffort(target.provider, target.model);
          } else if (catalog !== null && catalog.models.length > 0) {
            target = { provider: catalog.models[0].provider, model: catalog.models[0].model, manual: false };
            storedEffort = readStoredEffort(target.provider, target.model);
          }
          if (target === null) {
            // No catalog: ask the single-model endpoint for the current route so
            // the effort row still works on hosts without a model list.
            const detail = await loadModelDetail(null);
            if (!alive || detail === null) return;
            if (detail.provider === '' || detail.model === '') return;
            const fallback = { provider: detail.provider, model: detail.model, manual: false };
            setSelection(fallback);
            applyModelDetail(detail, fallback, readStoredEffort(fallback.provider, fallback.model));
            return;
          }
          setSelection(target);
          const detail = await loadModelDetail(target);
          if (!alive || detail === null) return;
          applyModelDetail(detail, target, storedEffort);
        })();
        return () => {
          alive = false;
        };
      }, [loadModelDetail]);

      // Opening the menu refreshes the "current model" while the plugin is
      // following it; a manual pick (or a lock) makes the choice stay put.
      react.useEffect(() => {
        if (!picking || lockSnapshot !== null) return undefined;
        if (selection !== null && selection.manual === true) return undefined;
        let alive = true;
        (async () => {
          try {
            const response = await fetch(MODELS_ENDPOINT, { headers: { accept: 'application/json' } });
            let body = null;
            try {
              body = await response.json();
            } catch {
              body = null;
            }
            const catalog = readModels(body, response.status);
            if (!alive || !catalog.ok || catalog.current === null) return;
            setModels(catalog.models);
            if (selection !== null && selection.provider === catalog.current.provider && selection.model === catalog.current.model) return;
            const target = { provider: catalog.current.provider, model: catalog.current.model, manual: false };
            setSelection(target);
            const detail = await loadModelDetail(target);
            if (!alive || detail === null) return;
            applyModelDetail(detail, target, readStoredEffort(target.provider, target.model));
          } catch {
            /* keep the old choice when the catalog cannot be refreshed */
          }
        })();
        return () => {
          alive = false;
        };
      }, [picking, lockSnapshot, selection, loadModelDetail]);

      const run = react.useCallback(async (flavour, shape, thinking, target) => {
        const text = typeof draft === 'string' ? draft : '';
        if (text.trim() === '' || busy) return;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        abortRef.current = controller;
        setPhase('busy');
        setNote('');
        try {
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(postBody(text, flavour, shape, thinking, typeof navigator !== 'undefined' ? navigator.language : undefined, target)),
            signal: controller === null ? undefined : controller.signal,
          });
          let body = null;
          try {
            body = await response.json();
          } catch {
            body = null;
          }
          const result = readResult(body, response.status);
          if (result.ok) {
            inputActions.setDraft(result.text);
            setNote(translate(result.engine === 'local' ? 'state.doneLocal' : 'state.doneLlm'));
            setPhase('done');
          } else {
            const code = result.error.code;
            const mapped =
              code === 'EMPTY_INPUT'
                ? translate('state.empty')
                : code === 'INPUT_TOO_LONG'
                  ? translate('state.inputTooLong')
                  : code === 'BUSY'
                    ? translate('state.busy')
                    : result.error.message;
            setNote(mapped);
            setPhase('error');
          }
        } catch (error) {
          if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
            setNote(translate('state.aborted'));
          } else {
            setNote(translate('state.network'));
          }
          setPhase('error');
        } finally {
          abortRef.current = null;
        }
      }, [draft, busy, inputActions, translate]);

      // The visible text is pinned in every state: `♂harden`, verbatim.
      const label = LABEL;
      // The menu opens whatever the composer holds — an empty box is a reason
      // not to forge, never a reason to keep the picker shut.
      const title = busy ? translate('button.titleBusy') : translate('button.title');

      const openPicker = () => {
        if (busy) return;
        setPicking((open) => !open);
      };

      // Picking a chip is a *selection*, not a commit: the menu stays open so
      // the other row can be picked too. Only the forge button spends a call.
      const forge = () => {
        if (empty) {
          // Nothing to forge: say so instead of going quiet.
          setNote(translate('state.empty'));
          setPhase('error');
          return;
        }
        setPicking(false);
        void run(style, preset, effort, selection);
      };

      const choose = (flavour) => {
        setStyle(flavour);
        rememberStyle(flavour);
      };

      const choosePreset = (shape) => {
        setPreset(shape);
        rememberPreset(shape);
      };

      const chooseModel = async (value) => {
        if (lockSnapshot !== null) return;
        let pair = null;
        try {
          const parsed = JSON.parse(value);
          if (Array.isArray(parsed) && parsed.length === 2) pair = parsed;
        } catch {
          pair = null;
        }
        if (pair === null || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') return;
        const target = { provider: pair[0], model: pair[1], manual: true };
        setSelection(target);
        rememberModel(target);
        const detail = await loadModelDetail(target);
        if (detail === null) {
          setEfforts([]);
          setEffort('');
          return;
        }
        applyModelDetail(detail, target, readStoredEffort(target.provider, target.model));
      };

      const chooseEffort = (id) => {
        if (lockSnapshot !== null) return;
        setEffort(id);
        if (selection !== null) rememberEffort(selection.provider, selection.model, id);
      };

      const toggleLock = () => {
        if (lockSnapshot !== null) {
          setLockSnapshot(null);
          clearStoredLock();
          return;
        }
        if (selection === null) return;
        const snapshot = { provider: selection.provider, model: selection.model, effort };
        setLockSnapshot(snapshot);
        rememberLock(snapshot);
      };

      const selectionValue = selection === null ? '' : JSON.stringify([selection.provider, selection.model]);
      const modelOptions = [];
      {
        const groups = new Map();
        for (const item of models) {
          if (!groups.has(item.provider)) groups.set(item.provider, { name: item.providerName, items: [] });
          groups.get(item.provider).items.push(item);
        }
        for (const group of groups.values()) {
          modelOptions.push(
            jsx('optgroup', {
              key: 'provider:' + group.items[0].provider,
              label: group.name,
              children: group.items.map((item) =>
                jsx('option', { key: item.provider + '/' + item.model, value: JSON.stringify([item.provider, item.model]), children: item.name }),
              ),
            }),
          );
        }
        if (modelOptions.length === 0 && selection !== null) {
          modelOptions.push(jsx('option', { value: JSON.stringify([selection.provider, selection.model]), children: selection.model }));
        }
        if (modelOptions.length === 0) {
          modelOptions.push(jsx('option', { value: '', children: translate('model.empty') }));
        }
      }

      // One control, two faces: the pill never leaves the row, the menu floats
      // above it. Keeping the pill mounted holds the row's height and the
      // toggle's focus, and gives `data-open` something real to report.
      const pill = jsxs('button', {
        type: 'button',
        className: 'dshPo_btn',
        'data-phase': phase,
        'data-open': picking ? 'true' : 'false',
        disabled: busy,
        title,
        'aria-label': busy ? title : label + '：' + title,
        'aria-busy': busy ? 'true' : undefined,
        'aria-haspopup': 'menu',
        'aria-expanded': picking ? 'true' : 'false',
        onClick: openPicker,
        children: [jsx('span', { className: 'dshPo_shine', 'aria-hidden': 'true' }), jsx('span', { className: 'dshPo_label', children: label })],
      });

      const chip = (group, id) => {
        const active = group === 'style' ? style === id : preset === id;
        return jsxs('button', {
          type: 'button',
          key: group + ':' + id,
          className: 'dshPo_chip',
          'data-group': group,
          'data-value': id,
          'data-style': group === 'style' ? id : undefined,
          'data-preset': group === 'preset' ? id : undefined,
          'data-active': active ? 'true' : 'false',
          role: 'menuitemradio',
          'aria-checked': active ? 'true' : 'false',
          title: translate(group + '.' + id + '.hint'),
          onClick: () => (group === 'style' ? choose(id) : choosePreset(id)),
          children: jsx('span', { className: 'dshPo_chipName', children: translate(group + '.' + id) }),
        });
      };

      const menu = picking
        ? jsxs('span', {
            className: 'dshPo_pick',
            role: 'menu',
            'data-dsh-prompt-optimizer': 'picker',
            children: [
              jsxs('span', {
                className: 'dshPo_row dshPo_modelRow',
                'data-dsh-prompt-optimizer': 'model-row',
                children: [
                  jsx('span', { className: 'dshPo_rowLabel', children: translate('model.label') }),
                  jsx('select', {
                    className: 'dshPo_select',
                    'data-dsh-prompt-optimizer': 'model-select',
                    value: selectionValue,
                    disabled: lockSnapshot !== null,
                    'aria-label': translate('model.label'),
                    title: translate('model.label'),
                    onChange: (event) => {
                      const value =
                        event !== null && typeof event === 'object' && event.target !== null && typeof event.target === 'object'
                          ? event.target.value
                          : '';
                      void chooseModel(value);
                    },
                    children: modelOptions,
                  }),
                  efforts.length === 0
                    ? null
                    : jsx('span', {
                        className: 'dshPo_effortChips',
                        'data-dsh-prompt-optimizer': 'effort-chips',
                        'aria-label': translate('effort.label'),
                        children: efforts.map((item) =>
                          jsxs('button', {
                            type: 'button',
                            key: 'effort:' + item.id,
                            className: 'dshPo_chip',
                            'data-effort': item.id,
                            'data-active': effort === item.id ? 'true' : 'false',
                            role: 'menuitemradio',
                            'aria-checked': effort === item.id ? 'true' : 'false',
                            disabled: lockSnapshot !== null,
                            title: translate('effort.hint'),
                            onClick: () => chooseEffort(item.id),
                            children: jsx('span', { className: 'dshPo_chipName', children: item.name }),
                          }),
                        ),
                      }),
                  jsxs('span', {
                    className: 'dshPo_lockWrap',
                    'data-dsh-prompt-optimizer': 'lock-wrap',
                    children: [
                      jsx('span', {
                        className: 'dshPo_lockLabel',
                        children: translate(lockSnapshot !== null ? 'model.locked' : 'model.lock'),
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'dshPo_switch',
                        'data-dsh-prompt-optimizer': 'lock',
                        'data-locked': lockSnapshot !== null ? 'true' : 'false',
                        role: 'switch',
                        'aria-checked': lockSnapshot !== null ? 'true' : 'false',
                        'aria-label': translate(lockSnapshot !== null ? 'model.unlockHint' : 'model.lockHint'),
                        title: translate(lockSnapshot !== null ? 'model.unlockHint' : 'model.lockHint'),
                        onClick: toggleLock,
                      }),
                    ],
                  }),
                ],
              }),
              jsxs('span', {
                className: 'dshPo_row',
                children: [
                  ...STYLE_IDS.map((id) => chip('style', id)),
                  jsx('span', { className: 'dshPo_sep', 'aria-hidden': 'true' }),
                  ...PRESET_IDS.map((id) => chip('preset', id)),
                ],
              }),
              jsxs('button', {
                type: 'button',
                className: 'dshPo_go',
                'data-dsh-prompt-optimizer': 'forge',
                disabled: busy,
                title: translate('button.forge'),
                onClick: forge,
                children: [
                  jsx('span', { children: translate('button.forge') }),
                  jsx('span', { className: 'dshPo_goHint', children: '· ' + translate('style.' + style) + ' / ' + translate('preset.' + preset) }),
                ],
              }),
            ],
          })
        : null;

      return jsxs('span', {
        className: 'dshPo_root',
        'data-dsh-prompt-optimizer': 'button',
        ref: rootRef,
        children: [
          pill,
          menu,
          note === ''
            ? null
            : jsx('span', {
                className: 'dshPo_note',
                'data-phase': phase,
                title: note,
                children: note,
              }),
        ],
      });
    }

    /**
     * Slot entry. Degrades to nothing when the composer's standard props are
     * missing instead of throwing inside the shell's render tree.
     */
    function HardForgeEntry(props) {
      const p = props === null || props === undefined ? {} : props;
      if (typeof p.useInput !== 'function' || p.inputActions === null || p.inputActions === undefined || typeof p.inputActions.setDraft !== 'function') {
        return null;
      }
      return jsx(HardForge, { useInput: p.useInput, inputActions: p.inputActions, t: p.t });
    }

    // ---------------------------------------------------------------------
    // Plugin face
    // ---------------------------------------------------------------------

    /** Client services this half needs: the slot registry and the dictionary. */
    const inject = ['slots', 'locale'];

    /**
     * Insert the stylesheet once, tagged like every shipped client bundle. A
     * failure here costs looks, never the button: the entry renders unstyled
     * instead of throwing.
     */
    function ensureStyle() {
      if (typeof document === 'undefined' || document === null) return null;
      try {
        if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_TAG) + ']') !== null) return null;
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-prompt-optimizer';
        tag.dataset.pluginCss = CSS_TAG;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return tag;
      } catch (error) {
        console.warn('[dsh-prompt-optimizer] stylesheet injection failed; the button renders unstyled:', error);
        return null;
      }
    }

    /**
     * Client plugin body: stylesheet, dictionaries, and the one composer entry.
     *
     * @param ctx - client root context.
     */
    function apply(ctx) {
      try {
        if (ctx.effect !== undefined && typeof ctx.effect === 'function') {
          ctx.effect(() => {
            const tag = ensureStyle();
            return () => {
              try {
                if (tag !== null && tag.parentNode !== null) tag.parentNode.removeChild(tag);
              } catch {
                /* already detached */
              }
            };
          }, 'dsh-prompt-optimizer: stylesheet');
        } else {
          ensureStyle();
        }
      } catch (error) {
        console.warn('[dsh-prompt-optimizer] stylesheet setup failed; the button renders unstyled:', error);
      }
      try {
        if (
          ctx.locale !== undefined &&
          ctx.locale !== null &&
          typeof ctx.locale.register === 'function' &&
          typeof ctx.effect === 'function'
        ) {
          ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-prompt-optimizer: dictionaries');
        }
      } catch (error) {
        console.warn('[dsh-prompt-optimizer] dictionary registration failed; falling back to built-in text:', error);
      }
      try {
        if (ctx.slots === undefined || ctx.slots === null || typeof ctx.slots.register !== 'function') {
          console.warn('[dsh-prompt-optimizer] no slot registry; the composer button is not mounted');
          return;
        }
        const register = () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: ENTRY_ID, order: 30, locale: NS },
            HardForgeEntry,
          );
        if (typeof ctx.slots.inject === 'function') ctx.slots.inject('conversation.input.left', register);
        else register();
      } catch (error) {
        console.warn('[dsh-prompt-optimizer] composer entry registration failed:', error);
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    // Test hooks: the module system reads only apply/inject.
    exports.HardForge = HardForge;
    exports.HardForgeEntry = HardForgeEntry;
    exports.NS = NS;
    exports.ENDPOINT = ENDPOINT;
    exports.MODEL_ENDPOINT = MODEL_ENDPOINT;
    exports.MODELS_ENDPOINT = MODELS_ENDPOINT;
    exports.readModel = readModel;
    exports.readModels = readModels;
    exports.resolveEffort = resolveEffort;
    exports.ENTRY_ID = ENTRY_ID;
    exports.CSS_TAG = CSS_TAG;
    exports.CSS = CSS;
    exports.zh = zh;
    exports.en = en;
    exports.LABEL = LABEL;
    exports.STYLE_IDS = STYLE_IDS;
    exports.STYLE_STORAGE_KEY = STYLE_STORAGE_KEY;
    exports.PRESET_IDS = PRESET_IDS;
    exports.PRESET_STORAGE_KEY = PRESET_STORAGE_KEY;
    exports.readStoredPreset = readStoredPreset;
    exports.rememberPreset = rememberPreset;
    exports.readStoredStyle = readStoredStyle;
    exports.rememberStyle = rememberStyle;
    exports.MODEL_STORAGE_KEY = MODEL_STORAGE_KEY;
    exports.LOCK_STORAGE_KEY = LOCK_STORAGE_KEY;
    exports.EFFORT_STORAGE_PREFIX = EFFORT_STORAGE_PREFIX;
    exports.readStoredModel = readStoredModel;
    exports.rememberModel = rememberModel;
    exports.readStoredLock = readStoredLock;
    exports.rememberLock = rememberLock;
    exports.clearStoredLock = clearStoredLock;
    exports.effortStorageKey = effortStorageKey;
    exports.readStoredEffort = readStoredEffort;
    exports.rememberEffort = rememberEffort;
    exports.postBody = postBody;
    exports.readResult = readResult;
    exports.translator = translator;
    return module.exports;
  },
});
