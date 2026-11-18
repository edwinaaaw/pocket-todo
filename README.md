# Pocket Todo

一个薄荷绿、淡紫色的 Y2K 桌面待办小工具，带果冻精灵、重复任务、成就与本地月报。使用 Electron、HTML/CSS/JavaScript 和 SQLite，可通过 MCP 与 Codex、千问办公共用任务。

## 功能

- 桌面置顶，无常规窗口边框；悬停展开，移开收起到当前显示器右上角。
- 果冻精灵眨眼、完成庆祝和成就反馈，支持减少动态效果。
- work / life / content / study 分组，以及 To-do / Pending / Completed / Cancelled 状态。
- 截止日期、拖动排序；× 取消当前任务，取消记录可恢复或删除，删除支持 10 秒撤销。
- 每天、工作日、每周指定星期、每月指定日期的重复任务；每期独立保存。
- 7 种成就、按实际完成日期统计的月报、PNG 导出。默认导出不包含任务标题。
- 本地 SQLite 持久化；通过 stdio MCP 让 AI 查询、添加、更新或完成任务。

## 本地运行

需要 Node.js 22.13 或更高版本，建议使用 Node.js 24。

```sh
npm ci
npm start
```

```sh
npm test
npm run build:mac
npm run build:win
```

Mac 构建结果在 `release/mac-arm64/Pocket Todo.app`（以实际架构目录为准）。Windows 安装包应在 Windows 环境构建和验证。Mac 已实机验证；Windows 尚未实机验证。当前构建未签名、未公证。

`npm run test:ui` 提供原生 Electron 自动化测试，需要允许启动图形应用的环境；`npm test` 包含数据层、MCP、窗口几何和 DOM 交互回归。

## 使用

拖动顶部把手移动展开的面板；收起时精灵回到所在屏幕右上角。输入框回车添加任务，点标题编辑；内部日期选择器打开期间不会自动收起。

输入框上方的“不重复”设置重复规则。首次计划任务保留，后续各期到当天生成；每月 29–31 日遇短月使用当月最后一天。取消只作用于当前一期；编辑中可停止后续重复，或确认跳过之前未完成期。

底部“成长册”查看成就与月报。每月末本地时间 20:00 后，运行中的应用提示月报已准备好；未运行时下次启动补生成。当月进度随时可看。撤销完成会更新统计，已获徽章保留，同一任务反复勾选不会重复增加终身成就数。

PNG 默认隐藏任务与习惯标题。选择包含标题时，图片最多列出 60 个任务和 20 个习惯，过长标题有明确截短说明，完整数据仍保存在应用中。

## AI 连接器

启动已构建的桌面应用，点击 **AI connections**，复制当前安装位置对应的配置：

- Codex：合并 TOML 到自己的 MCP 配置，重新加载 MCP 或新开聊天。
- 千问办公：扩展 → 连接器 → 添加 → 粘贴 JSON，导入并启用。

配置使用应用绝对路径。移动应用后应重新复制配置。应用内 Electron 可执行文件可运行 MCP 服务，无需另外安装 Node.js。

开发时也可以通过 `node /absolute/path/to/pocket-todo/src/mcp.cjs` 启动。必须使用支持 `node:sqlite` 的 Node.js 版本。

可用工具：`list_todos`、`add_todo`、`update_todo`、`complete_todo`、`cancel_todo`、`list_repeat_series`、`stop_repeat_series`、`skip_previous_occurrences`。

示例指令：

> 在 Pocket Todo 的 life 里添加“运动 15 分钟”，从今天起每个工作日重复。

> 停止运动这个系列的后续重复，保留现有记录。

AI 修改前应查询任务 ID；同名任务需明确目标。添加时使用稳定的 `requestId` 避免重试重复创建。MCP 不提供永久删除工具。

## 数据与隐私

数据保存在本机，不开公网服务，不需要额外模型 API key。月报通过本地规则生成。将任务交给 AI 客户端操作时，相关任务内容会进入该客户端的上下文，请自行选择适合的客户端。

- macOS：`~/Library/Application Support/Pocket Todo/`
- Windows：`%APPDATA%/Pocket Todo/`
- 可用 `POCKET_TODO_DATA_DIR` 指定隔离数据目录。

备份前退出小部件和使用该连接器的 AI 客户端，再复制完整数据目录。成长系统迁移前保存 `todos.sqlite.before-growth.bak`。旧版完成日期未知的任务仅计入历史累计，不伪造到具体月份。

仓库不包含个人待办、月报、账号配置、构建产物或依赖目录。系统日历同步、云同步、开机自启尚未实现。窗口置顶不覆盖系统安全界面。

## 项目结构

```text
src/       Electron 主进程、SQLite、重复规则、MCP、月报导出
ui/        桌面界面与果冻精灵素材
tests/     数据、MCP、界面与窗口回归测试
```
