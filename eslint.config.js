/**
 * ESLint 9 flat config — 仓库根正式配置，供 `npm run lint` 与 CI 共用。
 *
 * 设计要点：
 *
 *   - **零运行时依赖**：本文件与 eslint / @eslint/js 只在开发期使用，不进发布包
 *     （见 package.json 的 `files` 白名单）。
 *   - **手写 globals**：不引入 `globals` 包，只声明各文件实际用到的宿主全局。
 *   - **前后端分层**：宿主半只给 Node 全局，客户端半只给浏览器全局，
 *     这样在 client.js 里写 `process`、在 index.js 里写 `window` 都会被 no-undef 抓住。
 *   - **no-empty 放行空 catch**：插件刻意用 `catch {}` 静默降级（日志、清理、探测都会失败），
 *     这是设计选择，不是遗漏。
 *   - **no-var 全仓库生效**：`client.js` 的 CJS 包装层用 `const` 模拟绑定
 *     （只做属性读写、从不整体重赋值），因此不需要任何局部豁免。
 *   - **no-console 只放行 warn**：生产源码允许诊断用的 `console.warn`，
 *     但 `log` / `info` / `debug` 这类调试输出会被拦住；tools 下的测试脚本整体放行。
 */
import js from '@eslint/js';

/** 两种宿主都有的全局。 */
const sharedGlobals = {
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  queueMicrotask: 'readonly',
  structuredClone: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  fetch: 'readonly',
  performance: 'readonly',
  globalThis: 'readonly',
  Symbol: 'readonly',
  Promise: 'readonly',
};

/** 只在 Node 侧存在的全局。 */
const nodeGlobals = {
  ...sharedGlobals,
  Buffer: 'readonly',
  process: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

/** 只在浏览器侧存在的全局。 */
const browserGlobals = {
  ...sharedGlobals,
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  MutationObserver: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  HTMLElement: 'readonly',
  Node: 'readonly',
};

/** 仓库通用规则。 */
const sharedRules = {
  ...js.configs.recommended.rules,
  // 刻意静默的 catch：日志、清理、能力探测都会失败，静默是设计。
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  // 生产源码只允许诊断用的 warn。
  'no-console': ['error', { allow: ['warn'] }],
};

export default [
  {
    // 生成物与工作区状态不属于本仓库源码。
    ignores: ['node_modules/**', 'tmp/**', 'scratch/**', 'preview/**', '.trellis/**', '.dsh-ops/**', '.dsh/**', '.agents/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // 两种宿主共有的全局先铺一层，下面按文件再加各自独有的。
      globals: sharedGlobals,
    },
    rules: sharedRules,
  },
  {
    // 宿主半、开发工具与本配置文件跑在 Node 上。
    files: ['index.js', 'eslint.config.js', 'tools/**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    // 客户端半跑在浏览器里，只认浏览器全局。
    files: ['client.js'],
    languageOptions: { globals: browserGlobals },
  },
  {
    // 测试脚本与开发者工具本来就靠 console 输出。
    files: ['tools/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
