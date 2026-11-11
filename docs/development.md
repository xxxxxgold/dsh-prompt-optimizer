# 开发

回到 [README](../README.md) · 相关：[配置](./configuration.md) · [HTTP 面](./http-api.md)


> 下面这些命令都需要在**仓库工作树**里跑。`npm pack` 出来的发布包不含 `tools/`，
> 安装者不需要也不能运行它们；插件本身零运行时依赖。

```powershell
git clone https://github.com/xxxxxgold/dsh-prompt-optimizer.git
cd dsh-prompt-optimizer

# 装开发期依赖（只有 eslint，运行时零依赖不受影响）
npm install

# 一把梭：语法体检 → lint → 离线 297 项自测
npm run check

# 也可以单独跑
npm test          # 离线自测
npm run lint      # ESLint 9 flat config（根目录 eslint.config.js）

# 重出按钮截图（真 client.js + 真样式表，无头 Edge）
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
& $edge --headless=new --disable-gpu --hide-scrollbars --window-size=1060,500 `
  --virtual-time-budget=2600 --user-data-dir="$env:TEMP\dsh-po-shot" `
  --screenshot="preview\harden-button.png" `
  "file:///$PWD/tools/preview.html"
```

CI：[`.github/workflows/selftest.yml`](../.github/workflows/selftest.yml) 在 Node 18/20/22 上跑语法体检 + 自测；
lint 门禁只在 Node 20/22 矩阵跑（ESLint 9 对 18.x 末端补丁有版本下限要求）。

本地跑 `npm run lint` 需要 Node **≥ 18.18**（ESLint 9 的 `engines` 下限）；插件**运行时**仍然只要
`package.json` 里写的 `>=18`，因为 ESLint 只在 `devDependencies` 里。

**开发期依赖与发布包无关**：`eslint` / `@eslint/js` 只列在 `devDependencies`，
`package.json` 的 `files` 白名单只放运行时与文档（`index.js` / `client.js` / `cordis.patch.yml` /
`README.md` / `LICENSE` / `docs`），既不含 `devDependencies` 也不含 `tools/`，
所以 `npm pack` 出来的包装上去照样零依赖。`docs/` 进包是因为 npm 页面会渲染 README，
里面的文档链接必须在包内能解析。

**验证覆盖**（297 项）：模块名/inject、系统提示词铁律与样本、口味切换、Trellis 规范骨架（三种骨架 + 非法值回落 + 规范不吃掉口味）、输出卫生（代码围栏/前言/客套）、配置归一化、路由解析、流式拼接与失败码、本地兜底、`PRESET_NEEDS_MODEL`、短答打回重锻（`EXPANDED` / `THIN_OUTPUT`）、HTTP 各状态码、客户端 `__ModuleLoader__` 加载契约、字典、插槽注册元数据、菜单两行七个 chip 的文案与高亮、props 缺失不渲染、样式表注入与清理；最后一组是工程治理断言（`package.json` 的 scripts 严格顺序与 `--max-warnings=0`、零运行时依赖、`files` 白名单 + 真实 `npm pack` 内容、`tools/asar.mjs` 的路径探测与 ls/cat/grep 回归、README 计数自洽）。

其中外观有三道锁：

1. **标签钉死** —— `LABEL === '\u2642harden'`、码点 `0x2642`、长度 7、四态字典值全等；
2. **真渲染取文本** —— 跑一帧组件，从元素树读出可见文本，必须正好那七个字符；
3. **技法断言** —— 三层背景 + `background-clip: padding-box, padding-box, border-box` + 主题面 token 都在样式表里。

真 Chromium 计算样式探测（`tools/preview.html` 加载真实 `client.js`）：

```json
{
  "buttons": ["idle=♂harden", "busy=♂harden", "done=♂harden", "error=♂harden"],
  "backgroundClip": "padding-box, padding-box, border-box",
  "labelBackgroundClip": "text",
  "labelTextFill": "rgba(0, 0, 0, 0)",
  "glow": "rgba(255,106,0,0.1) 0 0 0 1px, rgba(0,0,0,0.14) 0 1px 3px, rgba(255,90,0,0.14) 0 0 12px"
}
```

### 目录

```
index.js                   宿主半：HTTP 面 + 提示词锻造 + 路由/降级
client.js                  客户端半：♂harden 按钮 + 样式 + 插槽注册
cordis.patch.yml           挂载声明：往 profile 里插一行 loader
package.json               dsh.bundle.patch / dsh.client 声明 + scripts + 发布白名单
package-lock.json          开发期依赖锁定（只有 eslint / @eslint/js）
eslint.config.js           ESLint 9 flat config：语法规则 + 前后端全局
.github/workflows/         CI：语法体检 + lint + 自测
tools/selftest.mjs         离线自测（297 项）
tools/preview.html         真组件预览 + 计算样式探测
tools/asar.mjs             Electron ASAR 迷你读取器（本地侦察用）
preview/harden-button.png  四态 + 菜单截图
scratch/                   本地侦察料，已 gitignore，不入库
```

> `tools/` 与 `eslint.config.js` 只在仓库里，不进 npm 发布包（见 `package.json` 的 `files`）。
