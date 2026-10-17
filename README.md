# 键盘翻页助手 KeyPaginator

> Firefox 扩展：按 **方向键或自定义按键**，自动点击页面上的「下一页 / 下一章 / Next」等翻页链接或按钮。
> 附带**阅读配色**与**对比度守护**，解决「底色设深后文字变黑、整页漆黑」的问题。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Firefox](https://img.shields.io/badge/Firefox-142%2B-orange?logo=firefox-browser)
![Manifest V3](https://img.shields.io/badge/manifest-MV3-blue)

---

## 功能

### 翻页

- **自动识别翻页元素**，按优先级依次尝试：
  1. 站点自定义 CSS 选择器（在设置里手写，优先级最高）
  2. `<link rel="next">` / `<a rel="next">` 等标准标记
  3. 文本 / aria-label / title / id / class 关键词匹配（下一页、下一章、Next、›、»、→……支持繁体）
  4. 数字分页兜底（当前页 3 → 自动找页码 4 的链接）
- **默认按键**：`→` 下一页、`←` 上一页；备用 `Alt+N` / `Alt+P`
- **按键自定义**：支持单键（`j`、`.`、`]`）和修饰键组合（`Ctrl+→`、`Shift+Space`），内置 9 种预设（Vim 风格 HJKL、PageDown 等），支持「捕获按键」直接按一下录入
- **防误触**：输入框 / 文本域 / 可编辑区域内不触发；默认忽略长按连发；元素带 `disabled` 属性自动跳过；反向词（「上一页」）不会误判为「下一页」
- **视觉反馈**：点击前橙色高亮框提示（时长可调、可关），右下角角标显示触发了哪个链接
- **站点级控制**：popup 一键禁用当前站点；黑名单列表
- **配置备份**：导出 / 导入 JSON

### 阅读配色与对比度守护

不少站点把配色写进 CSS 变量，一旦设成「深底 + 没设字色」，正文会回落纯黑，导致**黑底黑字、整页漆黑**。

- **5 套预设配色**：护眼绿 / 米黄纸 / 灰青 / 夜间 / 纯白，另支持自定义背景色与文字色
- **对比度守护**：无论怎么设，实际对比度低于阈值（默认 4.5，WCAG AA 正文标准）时自动纠正
- **分级注入**：`document_start` 声明式 CSS 先堵住黑屏窗口期，再测量真实对比度定稿
- **按站点生效**：默认不作用于任何站点，由你在设置页自行添加；也可一键对所有站点生效

> 本扩展**不预置任何站点名单**，避免内置特定域名，也便于你自行添加需要的站点。

---

## 安装

### 方式 1：本地临时加载（免签名，最快，开发用）

1. Firefox 地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点 **「临时载入附加组件…」**
3. 选择本目录的 `manifest.json`

> 缺点：重启 Firefox 后失效，需重新加载一次。

### 方式 2：提交 AMO 签名安装（长期可用）

Firefox 正式版默认禁止安装未签名的 xpi。选 **自行分发（Unlisted）** 即可，不必公开上架：

1. 打开 <https://addons.mozilla.org/zh-CN/developers/> 注册开发者账号
2. 「提交新附加组件」→ 选择 **「自行分发」（On your own）**
3. 上传 `python build.py` 产出的 `dist/keypaginator-<版本>.xpi`
4. 按提示提交，**不需要上传源码**（本项目为完整可读源码，无压缩混淆）
5. 等待自动校验 + 审核（自行分发通常 1–2 个工作日）
6. 在「我的附加组件」里下载 **「已签名文件」**
7. `about:addons` → 齿轮 → **「从文件安装附加组件」**，选中签名版 xpi

> **免审核的临时办法**（仅限 Developer Edition / Nightly / ESR）：`about:config` 把 `xpinstall.signatures.required` 设为 `false`，然后 `about:addons` → 从文件安装。

---

## 开发与打包

```bash
python build.py
```

产出三份内容完全一致的包（Firefox MV3 **强制要求** manifest 里带 add-on ID，故不区分本地版 / AMO 版）：

| 文件 | 用途 |
| --- | --- |
| `dist/keypaginator-<版本>.xpi` | **上传 AMO 用这份**（带版本号，不易拿错） |
| `keypaginator.xpi` | 插件目录下的当前包 |
| 上级目录 `keypaginator.xpi` | 备份 |

`build.py` 会在打包前自检，任一项不过直接 `exit 1`：

- `browser_specific_settings.gecko.id` 存在（MV3 必需）
- `data_collection_permissions` 是**对象** `{"required": ["none"]}`，不是数组
- `strict_min_version` 满足该字段的最低要求（桌面 140 / Android 142）
- manifest 引用的每个文件真实存在（**最容易漏、且静默失效**的一项）
- 打包文件齐全

> ⚠️ AMO 上同一 add-on 每次改动都必须递增 `version`，否则上传被拒。
> 若提示 **ID 已被占用**，把 manifest 里的 `gecko.id` 换成新的 UUID：
> `python -c "import uuid;print('{%s}' % uuid.uuid4())"`

### ⚠️ 提交前务必核对包内 manifest（防传旧包）

```bash
python -c "import zipfile,json;print(json.loads(zipfile.ZipFile('keypaginator.xpi').read('manifest.json'))['browser_specific_settings'])"
```

---

## 隐私与权限说明

本扩展**不联网、不采集数据、无远程代码执行**，全部识别与点击都在本地完成。

| 权限 | 用途 |
| --- | --- |
| `<all_urls>`（content script 匹配范围） | 核心用途就是在任意有翻页结构的网页上识别并点击「下一页/下一章」链接，无法预先枚举域名 |
| `storage` | 保存按键方案、站点选择器规则、配色设置和黑名单 |
| `activeTab` | 用户点击工具栏图标时读取当前标签页信息，用于显示站点开关与识别结果 |
| `tabs` | 设置页「添加当前站点」按钮需要读取当前页主机名 |
| `data_collection_permissions: ["none"]` | manifest 中显式声明不收集任何技术与交互数据 |

---

## 文件结构

```
.
├── manifest.json    # MV3 清单
├── content.js       # 核心：识别翻页元素 + 按键监听 + 点击
├── contrast.js      # 阅读配色 + 对比度守护
├── guard.css        # 配色兜底样式（document_start 注入）
├── background.js    # 初始化默认配置
├── popup.html/js    # 弹窗：快速开关、当前页识别结果、测试按钮
├── options.html/js  # 设置页：按键、预设、站点选择器、配色、黑名单、备份
├── icons/           # 图标（make_icons.py 生成）
├── make_icons.py    # 重新生成图标
├── build.py         # 打包成 xpi（含提交前自检）
└── LICENSE          # MIT
```

---

## 常见问题

- **某个站点识别不到？** 打开设置 → 「站点自定义选择器」，填该站下一页元素的选择器（F12 检查元素后右键 → 复制选择器），例如 `#next_chapter`。
- **某个站点出现黑底黑字？** 设置 → 「阅读配色」→「添加当前站点」，再挑一套预设即可。
- **在线文档 / 视频站方向键冲突？** 点工具栏图标，把「当前站点启用」关掉即可。
- **想连续翻页？** 设置 → 行为 → 打开「长按连发」。

---

## 已修复的 addons-linter 报错（踩坑记录）

| 报错 / 警告 | 级别 | 正确写法 |
| --- | --- | --- |
| The add-on ID is required in Manifest Version 3 and above | 错误 | 必须保留 `browser_specific_settings.gecko.id` |
| `data_collection_permissions` must be object | 错误 | 必须是**对象** `{"required": ["none"]}`，不能写成数组 |
| Manifest key not supported by the specified minimum Firefox version（桌面） | 警告 | `strict_min_version` ≥ **140.0** |
| 同上（Firefox for Android） | 警告 | Android 需 ≥ **142.0**，统一写 `142.0` 即可两条都过 |
| **Unsafe assignment to innerHTML** | 警告 | 用 `createElement` + `.textContent` / `appendChild`，不拼 HTML 字符串 |

### 构建期自动拦截高危写法

`build.py` 会扫描源码，发现以下写法直接 `exit 1`（避免上传到 AMO 才被拦）：

- `.innerHTML =` / `.outerHTML =`
- `insertAdjacentHTML(...)`
- `document.write(...)`
- `eval(...)` / `new Function(...)`
- `setTimeout("...")` / `setInterval("...")` 传字符串

打包成功时报告会显示 `linter 高危模式 0 处`。

### 关于扩展 ID

本仓库里的 `manifest.json` 用的是通用占位符 `keypaginator@example.com`。

**如果你在 AMO 上已有自己的 add-on 条目**，manifest 里的 ID 必须与建条目时用的**完全一致**，
否则 AMO 会直接拒收：

> 您的 manifest.json ({...}) 中的附加组件 ID 与您的附加组件在 AMO (xxx) 上的 ID 不匹配。

换 ID 只能**新建条目**，不能在旧条目里传。为避免误传，可以设环境变量启用校验：

```bash
# Windows CMD
set KEYPAGINATOR_AMO_ID=你的条目ID && python build.py
# PowerShell
$env:KEYPAGINATOR_AMO_ID='你的条目ID'; python build.py
# Bash
KEYPAGINATOR_AMO_ID=你的条目ID python build.py
```

不设该变量则跳过此项检查（发布给他人使用时保持这样即可）。

---

## 贡献

欢迎提 Issue 和 PR。改动后请务必跑一次 `python build.py` 确认自检通过。

## License

[MIT](LICENSE)