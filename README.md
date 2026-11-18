# Pocket Todo

A mint-and-lavender Y2K desktop todo companion with a jelly spirit, recurring tasks, achievements, and local monthly reports. Built with Electron, HTML/CSS/JavaScript, and SQLite, with MCP connectors for managing the same tasks in Codex and Qwen Office.

## Features

- An always-on-top, frameless desktop widget. Hover to expand; move away to collapse into the upper-right corner of the current display.
- A blinking jelly companion with completion celebrations, achievement feedback, and reduced-motion support.
- work / life / content / study groups and To-do / Pending / Completed / Cancelled tabs.
- Due dates and drag-to-reorder. The × button cancels the current task; cancelled tasks can be restored or deleted. Deletion includes a 10-second undo window.
- Daily, weekday, selected-weekday, and monthly recurring tasks, with each occurrence stored separately.
- Seven achievements, monthly reports based on actual completion dates, and PNG export. Task titles are excluded from exports by default.
- Local SQLite storage and a stdio MCP server for AI clients to query, add, update, and complete tasks.

## Run locally

Requires Node.js 22.13 or later; Node.js 24 is recommended.

```sh
npm ci
npm start
```

```sh
npm test
npm run build:mac
npm run build:win
```

The Mac build is generated at `release/mac-arm64/Pocket Todo.app` (the directory depends on the target architecture). Build and validate Windows installers on Windows. The app has been tested on a Mac; Windows has not yet been tested on a physical machine. Current builds are unsigned and not notarized.

`npm run test:ui` runs native Electron automation and requires an environment that can launch graphical applications. `npm test` covers storage, MCP, window geometry, and DOM interaction regressions.

## Usage

Drag the top handle to move the expanded panel. When collapsed, the companion returns to the upper-right corner of its display. Press Enter in the input field to add a task, or click a task title to edit it. The panel stays open while the built-in date picker is active.

Use the repeat control above the input (labeled “不重复”, meaning “Does not repeat”) to set a schedule. The initial scheduled task is retained; subsequent occurrences are generated when their date arrives. Monthly schedules on the 29th–31st use the last day of shorter months. Cancelling affects only the current occurrence. The editor also lets you stop future repeats or confirm cancellation of earlier unfinished occurrences.

Open the growth journal at the bottom (labeled “成长册”) to view achievements and monthly reports. After 8 p.m. local time on the last day of each month, the running app announces that the report is ready. If the app is closed, it generates the report on the next launch. You can view the current month’s progress at any time. Undoing completion updates statistics but preserves earned badges. Repeatedly checking the same task does not increase lifetime achievement counts.

PNG exports hide task and habit titles by default. If titles are included, an image lists up to 60 tasks and 20 habits. Long titles are explicitly marked as truncated; complete records remain in the app.

## AI connections

Launch the built desktop app, click **AI connections**, and copy the configuration for its current installation location:

- **Codex:** merge the TOML into your MCP configuration, then reload MCP or start a new chat.
- **Qwen Office:** open Extensions → Connectors → Add, paste the JSON configuration, then import and enable it.

Configurations use absolute application paths. Copy a fresh configuration after moving the app. The bundled Electron executable can run the MCP server, so a separate Node.js installation is not required for the packaged app.

During development, you can also run `node /absolute/path/to/pocket-todo/src/mcp.cjs`. Use a Node.js version that supports `node:sqlite`.

Available tools: `list_todos`, `add_todo`, `update_todo`, `complete_todo`, `cancel_todo`, `list_repeat_series`, `stop_repeat_series`, and `skip_previous_occurrences`.

Example prompts:

> Add “Exercise for 15 minutes” to life in Pocket Todo, repeating every weekday starting today.

> Stop future repeats of the exercise series while keeping existing records.

AI clients should look up task IDs before making changes and clarify the target when titles match. Use a stable `requestId` when adding a task to prevent duplicates on retries. The MCP server does not expose a permanent-delete tool.

## Data and privacy

Data stays on your device. The app does not expose a public network service or require an additional model API key. Monthly reports are generated using local rules. When an AI client manages your tasks, the relevant task content enters that client’s context; choose a client appropriate for your data.

- macOS: `~/Library/Application Support/Pocket Todo/`
- Windows: `%APPDATA%/Pocket Todo/`
- Set `POCKET_TODO_DATA_DIR` to use an isolated data directory.

Before backing up, quit the widget and any AI clients using its connector, then copy the entire data directory. A `todos.sqlite.before-growth.bak` backup is saved before the growth-system migration. Older tasks with unknown completion dates count toward historical totals only; they are not assigned to an invented completion month.

The repository excludes personal tasks, monthly exports, account configurations, build artifacts, and dependency directories. System calendar sync, cloud sync, and launch at login are not yet implemented. Always-on-top mode does not override system security screens.

## Project structure

```text
src/       Electron main process, SQLite, recurrence, MCP, report export
ui/        Desktop interface and jelly companion artwork
tests/     Storage, MCP, interface, and window regression tests
```
