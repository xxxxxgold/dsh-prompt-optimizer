# Feature PRD — 全方位全面测试，确保项目一点问题都没有

## 背景

`dsh-prompt-optimizer` 是一个零依赖的 DSH 插件（宿主半 `index.js`、客户端半 `client.js`），
仓库已有 `tools/selftest.mjs` 离线自测（当前实测 235 项通过）与 CI（Node 18/20/22 + 语法体检）。
用户要求对项目做**一遍全方位全面测试**，并以「项目一点问题都没有」作为交付判据。

规划期只读侦察已确认以下事实：

| 事实 | 证据 |
|---|---|
| 离线自测基线全绿 | `node tools/selftest.mjs` → `PASS — 235 passed, 0 failed` |
| 三入口语法可解析 | `node --check index.js client.js tools/selftest.mjs` 全部 OK |
| 插件已装入 desktop profile | `~/.dsh/profiles/desktop/node_modules/dsh-prompt-optimizer` |
| 真机 HTTP 面在线 | `GET /dsh-prompt-optimizer/health` → `ok:true, version 0.6.1` |
| 真机模型路由可用 | `GET /models` → 当前 `happycoding/deepseek-v4.1-flash`，含多 provider 备选 |
| 文档与实现已出现漂移 | README 多处写「185 项」，实测 235 项 |
| 本机仅一个 Node 版本 | `node -v` → v22.20.0；nvm4w 未装 18/20 |
| 规范目录尚未落地细则 | `.trellis/spec/frontend/*` 均为 `To fill` 模板 |

## 范围

### In Scope

八个执行批次，合起来覆盖「功能正确性 / 边界与错误路径 / 契约一致性 / 真实运行 / 文档 / 打包」六维：

1. **A 离线自测**：仓库既有 `tools/selftest.mjs` 全量执行，逐 section 核对结果。
2. **B 语法与静态体检**：`node --check` 全入口、ESM 解析、`package.json` 与 `exports` 路径存在性、
   `cordis.patch.yml` 结构合法性。
3. **C 静态代码审计**：错误码全集与抛出点交叉核对、边界条件、安全面（注入/请求体/配额）、
   生命周期清理（`ctx.effect`）、并发互斥（`BUSY`）、资源泄漏。
4. **D 跨 Node 版本**：Node 18 / 20 / 22 分别执行自测与语法体检。
5. **E 真机接口 E2E**：在真实 DSH 运行时（`127.0.0.1:54265`）验证 `/health`、`/models`、`/model`、
   `/probe`、`/optimize` 及各错误路径；包含真实模型锻造的质量抽样（铁律符合性）。
6. **F GUI UI E2E**：在真实 GUI 中验证按钮四态文案恒为 `♂harden`、菜单交互、点击「开锻」后回填输入框。
7. **G 文档一致性**：README/package.json/代码三方契约对齐（项数、路由、配置键、错误码、版本）。
8. **H 打包与安装契约**：`files` 清单、`exports` 可解析、`dsh.bundle.patch` 指向、profile link 有效性。

### Out of Scope

- 不新增运行时依赖、不引入测试框架（保持零依赖）。
- 不改变既有功能行为；仅修复测试中**证实**的缺陷（含文档缺陷），不做顺手重构。
- 不填 `.trellis/spec/` 的模板细则（除非 `trellis-update-spec` 阶段有明确沉淀结论）。
- 不覆盖 CI 云端实跑；跨版本以本机可执行方案为准，不可执行时须给出明确替代证据与限制说明。
- 不验证 Windows/macOS 之外的平台。

## 验收标准

- [ ] **A**：`node tools/selftest.mjs` 全部通过，失败数为 0，并附 section 级执行记录。
- [ ] **B**：全部入口 `node --check` 通过；`package.json`/`exports`/`cordis.patch.yml` 结构与路径校验通过。
- [ ] **C**：每条审计项都有明确结论（「有问题 + 证据 + 处置」或「无问题 + 证据」），无悬空项。
- [ ] **D**：Node 18/20/22 均执行自测与语法体检并通过；若某版本无法在本机获取，须写明原因、
      已尝试手段与替代证据，且不得伪称已在本机执行。
- [ ] **E**：真机各路由响应符合契约；错误路径返回预期状态码与错误码；真实模型抽样输出满足
      事实保真、无代码围栏、无前言客套三条铁律。
- [ ] **F**：GUI 中按钮四态文案恒为 `♂harden`（7 字符）；菜单可选口味与规范；点击「开锻」后
      输入框被替换为锻造结果且未自动发送。
- [ ] **G**：除已修复项外，README/package.json/代码三方无过期或矛盾描述。
- [ ] **H**：打包文件清单与 `files` 字段一致；`exports` 全部可解析；profile link 指向本项目且可加载。
- [ ] **总验收**：上述批次全部执行完毕、发现的真实问题全部修复并复跑验证通过，方可判定
      「项目一点问题都没有」。

## 约束与风险

- **只读规划期**：设计未获用户批准前不动业务代码（`index.js` / `client.js` / `tools/*`）。
- **真机 E2E 授权范围**：允许在 GUI 实际点击 `♂harden`，会真实消耗模型调用并覆盖输入框草稿；
  已获用户授权，**不自动发送**。
- **跨版本风险**：本机仅 v22.20.0；nvm4w 无 18/20。安装需网络与全局版本切换，须先探测可行性，
  切换后必须切回原版本，避免影响其他会话。
- **真机副作用**：`/probe` 与 `/optimize` 会实际调用模型，需控制调用次数并记录消耗。
- **误报风险**：静态审计结论须回到代码核实，不把「看起来可疑」当成缺陷；预算约 35% 误报率。
- **修复边界**：修缺陷可能触碰公开契约（如错误码文案），须最小化改动并保持向后兼容。

## 相关代码/文档

- `index.js` — 宿主半：HTTP 面 + 提示词锻造 + 路由/降级（导出 `apply`、`__internals` 及纯函数）
- `client.js` — 客户端半：`__ModuleLoader__` 模块、`♂harden` 按钮、样式、插槽注册
- `tools/selftest.mjs` — 离线自测（实测 235 项）
- `tools/preview.html` / `tools/asar.mjs` — 真组件预览与本地侦察工具
- `package.json` / `cordis.patch.yml` — 打包与挂载契约
- `README.md` — 用户文档（含「185 项」等过期描述）
- `.github/workflows/selftest.yml` — CI 定义（Node 18/20/22 矩阵）
- `.trellis/spec/frontend/index.md`、`.trellis/spec/guides/index.md` — 工程规范入口（当前为模板）
