# VibePerks for OpenCode (native plugin)

A native OpenCode plugin that renders **one quiet sponsor line in the OpenCode TUI
footer** (the `app_bottom` slot, visible on every screen) while your agent works -
and **nothing about your code, prompts, or files ever leaves your machine.**

```
Make your AI pay for itself - VibePerks.ai
```

This is the real footer integration built on OpenCode's TypeScript plugin API
(OpenCode's plugin surface is JS/TS only, so the footer cannot be reached from
Go).

## How it works

Two concerns, deliberately separated so the TUI never waits on a server:

- **The footer** renders from the local KV cache (`api.kv`) - instant and
  offline-safe. It only ever shows what is already cached.
- **The worker** runs off the `session.status` lifecycle. On a real prompt (the
  `busy` transition) it records the previously displayed impression, serves the
  next ad (`GET /v1/ads/serve`), and flushes buffered impressions
  (`POST /v1/impressions`). On `idle` it records the displayed impression and
  flushes. A serve only happens once per rotate window, so an idle terminal costs
  nothing.

All network, auth, caching, and the contract live in the small TypeScript client
in [`src/`](src) (`client.ts`, `config.ts`, `engine.ts`, `store.ts`). The plugin
entry [`src/tui.tsx`](src/tui.tsx) is the **single fail-silent boundary**: every
lifecycle handler runs inside one `try/catch` so any client error is swallowed and
OpenCode is never broken or slowed. That boundary is the only place errors are
swallowed.

## What leaves your machine

| Leaves your machine | Never leaves your machine |
|---|---|
| Device token (to authenticate) | Your code or file contents |
| Display facts: how long an ad was shown, CLI + plugin version | Your prompts or OpenCode's replies |
| | File names, paths, or repo names |

## Configuration

The plugin reads the **same** local config as the other VibePerks CLI adapters, so
one login configures them all:

- Config file: `~/.vibeperks/config.json` (override the directory with `$VIBEPERKS_HOME`),
  shape `{ "api_base", "device_token", "opt_out" }`.
- Env overrides: `$VIBEPERKS_DEVICE_TOKEN` (device token), `$VIBEPERKS_API` (API base).
- Opt out by setting `"opt_out": true` in the config file - the plugin then fetches
  nothing and reports nothing.

With no device token configured the footer shows a muted `vibeperks` placeholder
and makes zero network calls.

## Install

Install the plugin:

```
opencode plugin @vibeperks/opencode
```

Then link your device once with the token from the VibePerks website. OpenCode has
no `login` subcommand, so write the token to the shared config file (read by every
VibePerks adapter). A persistent file is used instead of an env var so the token
survives across sessions and works the same on every OS.

macOS / Linux:

```
mkdir -p ~/.vibeperks && printf '{"device_token":"YOUR_TOKEN"}\n' > ~/.vibeperks/config.json && chmod 600 ~/.vibeperks/config.json
```

Windows (PowerShell):

```
New-Item -Force -ItemType Directory "$HOME\.vibeperks" | Out-Null
Set-Content "$HOME\.vibeperks\config.json" '{"device_token":"YOUR_TOKEN"}'
```

If you already signed in with another VibePerks adapter (Claude Code, Codex,
Terminal, or a VS Code extension), the token is already in that shared config and
OpenCode picks it up automatically - no second login needed.

## Uninstall

Remove `@vibeperks/opencode` from your OpenCode plugin list (the same list you added
it to), then restart OpenCode - the footer line stops showing. To pause it without
uninstalling, set `"opt_out": true` in `~/.vibeperks/config.json`. Your token and cache
live in `~/.vibeperks/` - delete that folder if you want to remove them too.

## Develop

Requires Node 22+.

```
npm install            # dev deps (typescript, vitest, prettier)
npm run typecheck      # typecheck the client logic
npm run typecheck:tui  # typecheck the JSX entry (installs OpenCode peer deps first)
npm test               # vitest: unit + mocked-contract + privacy tests
npm run format:check   # prettier
```

The OpenCode runtime provides the peer dependencies (`@opencode-ai/plugin`,
`@opentui/solid`, `solid-js`); they are not bundled.

## License

Source-available under the [PolyForm Shield License 1.0.0](LICENSE). You may read,
audit, and use this code, but not to build a product that competes with VibePerks.
Copyright (c) 2026 VibePerks.
