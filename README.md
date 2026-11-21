# Up.computer

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Project-MMG's independently maintained version of Up.computer. Run Claude Code, Codex, and other
coding agents with your own subscriptions. Organize their work in project chats, tasks, and bots.

![Up.computer with bots in the sidebar, a new chat and the planner with today's tasks](./assets/readme/app-light.png)

<p>
  <img src="./assets/readme/app-dark.png" width="49%" alt="Dark theme with bots, threads and the week in the planner">
  <img src="./assets/readme/app-themes.png" width="49%" alt="A chat that changed the app's theme to Solarized on request">
</p>

[Issues](https://github.com/Project-MMG/upcomputer/issues) ·
[Pull requests](https://github.com/Project-MMG/upcomputer/pulls) ·
[Releases](https://github.com/Project-MMG/upcomputer/releases) · [Docs](./docs/README.md) ·
[Getting started](./docs/user/getting-started.md) · [FAQ](./docs/user/faq.md)

## Why Up.computer

- **Your agents in one place.** Claude Code, Codex, Cursor, OpenCode and more run side by side.
  Pick the agent and model for each chat, and switch between them from one sidebar.
- **Work that runs in the background.** Say what you want done in a chat. It becomes a task, and a
  worker picks it up while you keep talking. Workers can hand off to each other, for example one
  writes the code and another reviews it.
- **Bots that remember.** Turn a chat into a bot: one permanent chat with its own memory. It answers
  you and passes bigger jobs to workers.
- **Your chats stay on your computer.** Threads, tasks and settings live on your machine. Your code
  and prompts go straight to your agent's provider, not to us.

## Install

Run this fork [from source](#run-from-source) or package a local desktop build with the
[desktop artifact instructions](./docs/operations/development.md#desktop-artifacts).
Builds published by Project-MMG appear in the [fork's releases](https://github.com/Project-MMG/upcomputer/releases).

See [Getting started](./docs/user/getting-started.md) to connect an agent.

To use your own agents, set up the ones you want:

- Codex: connect with ChatGPT in **Settings → Providers**, or install the
  [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`.
- Claude Code: install [Claude Code](https://claude.com/product/claude-code) and run
  `claude auth login`.
- Cursor: sign in from **Settings → Providers → Cursor**, or set `CURSOR_API_KEY`. No Cursor CLI
  is needed.
- Grok Build: install the [Grok Build CLI](https://x.ai/cli) and run `grok login`.
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`.
- Antigravity: install it and sign in with Google from its provider settings. No CLI is needed.
- Pi, Kiro, Muse Code and fx: see the [provider setup table](./docs/user/install.md#providers).
- Other agents: choose **Add provider** in **Settings → Providers** to add an agent from the
  [ACP Registry](https://agentclientprotocol.com/get-started/registry) or a local ACP command.

Codex and Claude are on by default. Turn the others on in **Settings → Providers**.

## What It Does

- **Chats.** Run any of your agents in project threads, with diffs of what changed. Commit, push
  and publish repositories from the app.
- **Tasks and workers.** Tasks have a title, a status and tags. A worker is a saved setup (agent,
  model, instructions) that picks up tasks by status and tag. Ask in any chat and the agent creates
  the task and the worker for you.
- **Automations.** Create tasks on a schedule, so workers start on their own.
- **Bots.** A permanent chat with long-lived memory that can do work itself or hand it to workers.
- **Project tools.** Connect apps through Composio and assign access to all or selected bots in a project.
- **The planner.** Your own tasks and routines, next to the workers' tasks.
- **Computer use.** Agents get a managed browser and can see and control the desktop.
- **Remote access.** Reach your computer from another computer or a browser with UpComputer
  Connect, your local network or Tailscale. See [Remote access](./docs/user/remote-access.md).

Up.computer sends basic product usage events, never prompts, replies or file contents. See
[Product usage data](./docs/user/telemetry.md) to turn them off.

## Feedback

Track bugs, feature work, and review on [Project-MMG/upcomputer](https://github.com/Project-MMG/upcomputer/issues).
The [contribution guide](./CONTRIBUTING.md) covers how to propose and verify changes.

## Run From Source

Install Git and [Vite+](https://viteplus.dev/guide/). Vite+ uses the Node version pinned in
`package.json`. Run these commands from the checkout you want to test.

```bash
vp i
vp run dev
```

Other development commands: `vp run dev:web`, `vp run dev:server`, `vp run dev:desktop` and
`vp run dev:marketing`. See the [development runbook](./docs/operations/development.md) for
worktrees, ports and test data.

## Repository Layout

- `apps/desktop`: Electron desktop shell and release integration.
- `apps/server`: Node.js server that runs agent sessions and serves the web app.
- `apps/web`: React/Vite app for the main product UI.
- `apps/marketing`: Astro marketing and download site.
- `packages/contracts`: Shared Effect Schema contracts for provider events, the WebSocket
  protocol, settings and sessions.
- `packages/shared`: Runtime utilities shared by server and clients.
- `packages/client-runtime`: Client code shared by web and mobile.
- `packages/effect-acp` and `packages/effect-codex-app-server`: Agent protocol clients.
- `packages/provider-*`: Provider adapters.
- `packages/source-control-*`: Git hosting integrations.
- `packages/ssh` and `packages/tailscale`: Remote environment support.
- `packages/tasks-*`: Tasks, workers, bots, the planner and automations.
- `packages/computer-use-*`: Browser automation and computer use.
- `docs`: User and operations docs.

- `infra/relay`: Relay code for UpComputer Connect.
- `apps/mobile`: React Native reference client.

## Project history

This project descends from [Up.computer](https://github.com/krl-gr/upcomputer) and
[T3 Code](https://github.com/pingdotgg/t3code). Project-MMG owns the roadmap, issues, and PRs for
this fork.

The `@t3tools/*` package scope, `T3CODE_*` variables, and `t3` protocol identifiers support existing
integrations. [Branding and compatibility](./docs/branding.md)

## Contributing

Use the [contribution guide](./CONTRIBUTING.md) and [project instructions](./AGENTS.md) for
GitHub issues, implementation, and review.

## Security

Share vulnerability reports privately with the fork maintainers. [Security policy](./.github/SECURITY.md)

## License And Brand

The source code is MIT licensed. See [LICENSE](./LICENSE). Release builds also bundle third-party
components under their own licenses, listed in the app under
**Settings → General → Open source licenses**.

The MIT license does not grant rights to the Up.computer name, logo or visual identity. You may use
the name to refer to this project, but not in a way that suggests endorsement or an official build
without permission.
