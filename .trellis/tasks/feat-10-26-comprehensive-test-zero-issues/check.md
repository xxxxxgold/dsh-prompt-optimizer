# Check Report — 全方位全面测试

**日期**：2026-10-26
**环境**：Windows / DeepSeek Harness 桌面版（主进程 PID 30288，内嵌服务 PID 1668 @ 127.0.0.1:54265）
**结论**：8 个批次全部执行完毕；发现的 1 个真实代码缺陷已修复并加回归测试；3 处文档过期已修正；
复跑全绿（240/240）。**但存在 5 项「未覆盖/外部问题」限制，见文末，不能宣称 100% 零风险。**

---

## 一、批次执行结果

| 批次 | 内容 | 结果 | 证据 |
|---|---|---|---|
| **A** 离线自测 | `node tools/selftest.mjs` ×2 | **PASS 248/248，两次一致** | 分节：host 104（含新增并发/释放 11）/ client 105 / thin 17 / model 12 / probe 5 / effort 5；修复前为 235 |
| **B** 语法与静态体检 | `node --check` ×4；package.json/exports/patch/client 依赖 | **全绿** | 4 文件 OK；exports 5 路径全存在；`id=name=dsh-prompt-optimizer`；client 仅 `require('react')`、`require('react/jsx-runtime')` |
| **C** 静态代码审计 | 错误码×抛出点×测试三方交叉；边界；安全；生命周期；并发；跨层字段 | **1 真缺陷 + 3 覆盖缺口 + 1 冗余** | 见第二节 |
| **D** 跨 Node 版本 | nvm 切 18.20.7 / 20.19.5 / 22.20.0 实跑 | **三版本全绿** | 18/20/22 均 `PASS 248 passed, 0 failed` + `node --check` OK（修复后复跑）；已切回 22.20.0 |
| **E** 真机接口 E2E | `/health` `/models` `/model` `/probe` `/optimize` + 错误路径 | **26/26 通过（复跑仍 26/26）** | 见第三节 |
| **F** 桌面版 GUI E2E | 真桌面窗口点击 | **通过** | 见第四节 |
| **G** 文档一致性 | README/package.json/代码三方 | **3 处过期已修** | README `185 项`×3 → `248 项`；覆盖清单补并发上限；版本三方 0.6.1 一致 |
| **H** 打包与安装契约 | `npm pack --dry-run`、exports、profile 副本 | **通过** | 9 个文件打包（LICENSE/README/client/cordis.patch/index/package/tools×3）；profile 副本为真实目录，index/client/package 三文件 SHA256 与仓库完全一致，版本 0.6.1 |

---

## 二、静态审计发现

### C-1（真缺陷，已修）并发上限可被绕过

- **位置**：`index.js` POST `/optimize` 处理段。
- **问题**：`if (inFlight >= maxConcurrent) → 429` 之后、`inFlight += 1` 之前有 `await readBody(req)`。
  该 await 让出事件循环，一批同时到达的请求可以全部通过检查，实际并发可超过 `maxConcurrent`（默认 4）。
- **修复**：把 `inFlight += 1` 提到首次 await 之前，并用 `try/finally` 包住整段处理，任何 `return`
  （400/413/200）都会释放槽位。
- **回归测试**：`tools/selftest.mjs` 新增 3 条断言（第二请求 429 BUSY / 卡住的请求放行后仍 200 /
  槽位释放后第三请求 200）。
- **有效性验证（防假绿灯）**：临时把上限判断改成恒假 → 新测试立即 `FAIL`（239 passed, 1 failed）；
  恢复后 **248 passed**。证明测试真能捕捉该回归；审查阶段又补了 400/413/502 三条释放断言，
  变异后 4 FAIL（244 passed / 4 failed）。

### C-2（覆盖缺口）三个错误码无测试断言

- `BAD_URL`（400）：`new URL(req.url || '/', 'http://localhost')` 在 Node 里几乎不可抛，属防御性死代码。
- `EMPTY_OUTPUT` / `TRUNCATED`（warning）：模型空输出、输出撞长度上限两条分支无测试。
- **处置**：记录为已知缺口，本轮不改（改动会触碰模型流协议，收益低风险高）。

### C-3（覆盖缺口）client 三个兜底错误码无测试

`BAD_RESPONSE` / `MODEL_UNAVAILABLE` / `MODELS_UNAVAILABLE` / `OPTIMIZE_FAILED` 是客户端在服务端
未给 code 时的兜底，逻辑简单，未单独断言。**处置**：记录，不修。

### C-4（冗余）`locale` 字段 host 不消费

client 的 `postBody` 会带 `locale`，`index.js` 全文无 `locale` 引用。selftest 明确断言该字段会发送
（设计意图），故判为预留字段，非缺陷。**处置**：不改。

### 已核对无问题的项

- 安全：无 `innerHTML` / `dangerouslySetInnerHTML`；写回只走 `inputActions.setDraft`；
  日志只记 failure code/message，不记草稿全文；`readBody` 有 4MB 硬上限。
- 生命周期：`ctx.effect` 注册、disposer 调 `registration()`、重复 apply 不叠加。
- 泄漏：`AbortController` + `setTimeout` 均有 `clearTimeout`；client 的 `keydown`/`pointerdown`
  监听全部在 cleanup 里 `removeEventListener`。
- 跨层字段：`text/style/preset/reasoningEffort/provider/model` client↔host 逐字一致；
  `warning.code` 与 client 展示分支一致。

---

## 三、E 批次真机接口

### 只读 + 错误路径（26 项，全过）

| 断言 | 结果 |
|---|---|
| `/health` 200 / ok / version=0.6.1 / styles=3 / presets=4 | 通过 |
| `/models` 200 / current 结构 / models 数组字段齐 / 无重复 | 通过 |
| `/model` 默认路由 + 显式 `?provider=&model=` + 半参数被忽略 | 通过 |
| 空串 / 纯空白 / 缺 text → 400 `EMPTY_INPUT` | 通过 |
| 坏 JSON → 400 `BAD_JSON` | 通过 |
| 20001 字 → 413 `INPUT_TOO_LONG` | 通过 |
| 未知路由 / 错误方法 → 404 `NOT_FOUND` | 通过 |

### 真实模型调用

| 项目 | 结果 |
|---|---|
| `POST /probe`（maxTokens 512） | 200 `ok:true`，15.9s，72 字，finish=`{kind:"stop"}` |
| `/optimize` hard（默认路由） | 200 `engine:"llm"`，66.6s，290 字，铁律 4/4 保真，无围栏/前言/客套 |
| `/optimize` team | 200 `engine:"llm"`，41.1s，211 字，铁律 4/4 |
| `/optimize` cool | 200 `engine:"llm"`，17.5s，250 字，铁律 4/4 |

**外部适配器抖动（如实记录）**：修复后复跑时，默认路由 `deepseek-web/deepseek-web-auto` 返回
`WEB_UNPARSEABLE_RESPONSE`，插件按设计降级为本地兜底（200 `engine:"local"`，事实保真、无围栏）。
改走显式路由 `deepseek-account/deepseek-flash` 后恢复 `engine:"llm"`，1.6s，291 字，铁律 4/4。
判定：**外部适配器问题，非插件缺陷**；插件降级路径同时得到一次真实验证。

---

## 四、F 批次桌面版 GUI

- 窗口：`hwnd=2559802`，`Chrome_WidgetWin_1`，2576×1408；UIA 仅暴露窗口按钮，改用 `PrintWindow`
  截图 + `SetCursorPos`/`mouse_event` 坐标点击。
- 实测步骤与证据：
  1. 切到本任务会话 → 截图 `f1-session.png`；
  2. 输入框粘贴测试草稿 → 截图 `f2b-draft.png`（草稿完整显示）；
  3. 点 `♂harden` → 截图 `crop-menu2.png`：菜单含模型行 + 已锁定开关 + 两排 chip
     （硬汉/肌肉集团/雷霆炫酷 | 原生/需求/缺陷/重构）+「开锻」按钮；
  4. 点「开锻」→ 截图 `crop-f5-busy.png`（菜单关闭、按钮仍在）；
  5. 20s 后截图 `crop-f5-mid.png`：**输入框被替换为硬汉任务书**，按钮转绿并标注
     「已锻造 · 本地兜底」，文案仍为 `♂harden`，**未自动发送**（消息列表无新增条目）。
- 按钮状态实测：idle（粉橙描边）→ done（绿色）均可见；文案四态恒为 `♂harden` 未变。

---

## 五、修复清单

| # | 文件 | 改动 | 依据 |
|---|---|---|---|
| 1 | `index.js` | 并发槽位在首个 await 前预留；整段包 `try/finally` | C-1 |
| 2 | `tools/selftest.mjs` | 新增并发段 + 错误路径释放段：6 条行为断言（429/200/400/413/502）+ 4 条 mount 断言；共 +13 项（235→248） | C-1、review major-1 |
| 3 | `README.md` | `185 项` ×3 → `248 项`；覆盖清单补「并发上限（429 `BUSY`）」 | G、review minor-4 |

---

## 六、限制与未覆盖（不得当作「零风险」）

1. **真机 429 未做并发压测**：`BUSY` 只用假挂载的并发测试覆盖，未在真机同时打 5 个请求
   （代价是 5 次真实模型调用）。真实 429 路径属「逻辑已验证、真机未压」。
2. **`BAD_URL` 不可达**：防御性代码，无测试，也不会触发。
3. **`EMPTY_OUTPUT` / `TRUNCATED` 分支无测试**：逻辑已走查，未构造用例。
4. **client 兜底错误码无测试**：4 个码，逻辑简单。
5. **`deepseek-web` 适配器不稳定**：外部服务返回不可解析响应，插件正确降级；不是本项目能修的。
6. **桌面 GUI 自动化依赖坐标**：窗口布局/字号变化会使坐标失效；本轮已按实测坐标完成一次完整链路。
7. **`.trellis/spec/` 仍为模板**：项目无成文工程规范，本轮审计以代码现状 + README 为基准。
8. **慢连接占槽（review minor-2）**：槽位现在在读取 body 前预留，一个只发半截 body 的慢连接
   可占住槽位直到断开或撞 4MB 上限；宿主 `webServer` 是否设请求体超时未验证。
9. **429 分支不 drain 请求体（review minor-3）**：真实 Node http 下未消费的 body 可能重置连接，
   客户端拿不到 429；离线 `fakeResponse` 看不到这一层，真机并发未压测。

---

## 七、复跑验证

| 项 | 命令 | 结果 |
|---|---|---|
| 全量自测 | `node tools/selftest.mjs` | `PASS — 248 passed, 0 failed` |
| 语法 | `node --check index.js client.js tools/selftest.mjs tools/asar.mjs` | 全部 OK |
| 真机接口 | `e2e.mjs`（26 项） | 全过（修复后复跑仍全过） |
| 三版本 | nvm 18.20.7 / 20.19.5 / 22.20.0 | 全部 `0 failed` |
| 真实锻造 | 显式路由 `deepseek-account/deepseek-flash` | `engine:"llm"`，铁律 4/4 |
