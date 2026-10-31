# BioFocus

一个为科研论文阅读设计的 Windows PDF 阅读工具。用逐行聚焦减少干扰，把高亮、笔记、翻译和查词记录留在同一处。另附可本机运行和部署的网页开发版。

## Windows 使用

从 [Releases](https://github.com/TianL-07/biofocus-pdf/releases) 下载 Windows 压缩包，解压后运行 `BioFocus.exe`。请保留同一目录内的 DLL、`bridge.js` 和 `app/`，不要只移动 EXE。

运行环境：Windows 10 / 11、.NET Framework 4.8、Microsoft Edge WebView2 Runtime。应用无需 Node.js。WebView2 使用系统安装并更新的运行环境。

### 文献文件夹

首次启动时，若桌面存在“文献阅读”文件夹，应用会直接连接它，并扫描子目录中的 PDF。也可以点击文献库的文件夹标题更换目录。新增、移除或修改文件后自动刷新。

- 点击文件夹条目会直接读取原 PDF，不复制整份文件进应用数据库。
- 高亮、笔记、词汇、提问和进度保存在应用自己的本机存储中。
- 文献按内容哈希识别，相同内容的文件可以沿用阅读记录。
- 修改或替换 PDF 的内容后会视为新的文献，避免把旧批注错误地套到新内容上。
- 原文件不会被改写；移除“我的文献”中的阅读记录也不会删除文件夹里的原 PDF。
- 扫描最多递归 10 层、5000 个 PDF，不跟随符号链接。单篇大小上限 150 MB。

## 功能

| 功能 | 当前行为 |
| --- | --- |
| 逐行聚焦 | 聚焦框外遮暗，支持 1–12 行、遮暗程度调节及点击定位 |
| 快捷键 | `↑` / `↓` 移动聚焦框；3 行及以上每次移动行数的一半（向下取整）；`←` / `→` 调整行数 |
| 图片与图表常亮 | 自动检测内嵌图片，尝试聚类矢量图；可手动添加或清除常亮区域 |
| 白天 / 黑夜 | 两套界面主题，自动记忆选择；PDF 图像保持原色 |
| 批注 | 选词高亮、添加与编辑笔记、删除批注 |
| 导出 | 带高亮及附注的 PDF、阅读记录 JSON、本文词汇 CSV |
| 备份恢复 | 对应同一 PDF 内容哈希的 JSON 记录可重新导入 |
| 有道翻译 | 选中文字后显示译文；支持医学领域与自定义术语表 ID |
| 文章词汇本 | 逐篇保存查询文字、译文、页码、上下文、来源、次数和失败状态 |
| GPT 侧栏 | 选中内容可带入右侧面板并保存问题；当前按需求暂不连接模型 |

方向键在输入框、笔记编辑框或文字选中时保留正常编辑行为。也可用阅读器底部按钮移动聚焦框。1–2 行时步长为 1；3 行为 1；4–5 行为 2；6–7 行为 3，以此类推；页末自动换页。竖排下载水印不参与正文行导航。

### 图表识别与 PDF 限制

逐行阅读依赖 PDF 的文本层。扫描件需要先经过 OCR；本版不包含 OCR 引擎。双栏阅读顺序和图表识别采用启发式方法，复杂排版、公式、旋转文字或特殊矢量图可能需要手动定位及补充图表常亮框。手动画框模式下可清除本页的手动区域。

## 配置有道智云

在应用设置中填写：

1. **AppKey**：应用 ID。
2. **AppSecret**：应用密钥。
3. **领域**：默认医学 `medicine`。需要先在有道控制台开通医学领域；若未开通，可选择通用 `general`。
4. **vocabId**：可选的有道术语表 ID，适合加入项目常用的生物医学术语。

配置入口不自动发起付费翻译。点击翻译时，只把所选文字发送给有道，整篇 PDF 和阅读笔记不会一起发送。医学模式使用 `rejectFallback=true`，避免把通用翻译标注成医学领域结果。失败时显示接口错误，需手动重试。

桌面版通过 Windows DPAPI 的 `CurrentUser` 作用域加密凭据，保存在本机 `%LOCALAPPDATA%/BioFocus/youdao.bin`。设置页不会读回密钥明文；支持清除凭据。不要将密钥写入源码、GitHub、`VITE_*` 环境变量或聊天记录。

有道接口已按官方 v3 签名协议实现，并通过模拟响应测试。真实服务调用需要使用者提供并启用自己的账号配置；项目不附带密钥。翻译配额和费用由有道账户决定。

官方文档：[文本翻译 API](https://ai.youdao.com/DOCSIRMA/html/trans/api/wbfy/index.html)。

## GPT 问答状态

GPT 服务按当前需求保留到后续配置。本版能从选中内容生成提问草稿、在右侧展开面板、保存提问；不会返回模拟模型回答，也不会把问题自动发送给任何服务。

后续接入应通过桌面原生端或服务端保管 API Key，并明确所发送的文献上下文范围。参考 [OpenAI Responses 与会话状态文档](https://developers.openai.com/api/docs/guides/conversation-state)。

## 源码开发

需要 Node.js 20.19+，推荐使用维护中的 LTS 版本。

```sh
npm ci
npm run dev
```

在终端打印的 `http://127.0.0.1:5173` 打开网页开发版。

```sh
npm test          # 阅读顺序、聚焦框、有道签名与错误、文件夹边界测试
npm run build    # TypeScript 检查与前端构建
npm run package  # Windows 上生成 release/BioFocus-Windows/
npm run desktop  # 构建并启动 Windows 程序
```

Windows 构建脚本从微软官方 NuGet 下载固定版本 WebView2 SDK，依据官方包目录中的 SHA-512 校验值验证下载内容，然后使用系统 .NET Framework C# 编译器生成程序。SDK 缓存放在被 Git 忽略的 `.native/`。其他系统可运行网页开发版和前端构建，Windows 桌面程序需要在 Windows 上编译。

原生检查可运行：

```powershell
.\release\BioFocus-Windows\BioFocus.exe --self-test .\native-test-result.txt
```

该检查覆盖 v3 签名输入、Windows 凭据加解密和文件夹路径边界，不访问真实翻译服务。

### 网页版翻译与部署

开发版设置页将有道凭据传给本机 Node 服务，仅保存在该进程内存中，重启需重新填写。开发服务仅监听回环地址，验证来源及 Host，不允许其他网站跨域配置。

`npm run build` 的 `dist/` 可部署到静态托管，支持 PDF 阅读、批注和本地保存。纯静态部署不包含有道密钥签名服务，翻译需要另接后端。

`npm start` 会在本机提供构建后的页面和翻译接口，凭据可通过 `YOUDAO_APP_KEY`、`YOUDAO_APP_SECRET`、`YOUDAO_DOMAIN`、`YOUDAO_VOCAB_ID` **进程环境变量**配置；示例 `.env.example` 不会被自动加载。生产模式禁止网页配置凭据。如需对外提供服务，必须自行增加访问认证、HTTPS、限流与用户隔离，避免多人共享账户密钥。

## 数据与隐私

应用源码和安装包不包含个人 PDF、原文路径列表、笔记、查词记录或服务密钥。默认示例文献及示意图由项目自行生成，明确标注为示例，不代表真实实验结果。

桌面数据在 `%LOCALAPPDATA%/BioFocus/`，网页数据在当前站点的 IndexedDB / localStorage 中。建议定期导出阅读记录备份。删除应用数据、清除浏览器存储或更换站点域名可能导致无法访问原阅读记录。

## 技术结构

- `src/`：React + TypeScript，PDF.js 渲染、文本选择、聚焦遮罩和阅读工作台。
- `windows/`：WinForms + WebView2 桌面壳、本机 API、文件夹监听和 DPAPI。
- `server/`：网页开发版服务、有道 v3 签名及文件夹逻辑测试模块。
- `scripts/build-windows.mjs`：可复现的 Windows 构建入口。
- `tests/`：不依赖真实服务凭据的自动化测试。

MIT License。PDF.js、pdf-lib、React、Lucide 和 WebView2 等依赖遵循各自许可证。
