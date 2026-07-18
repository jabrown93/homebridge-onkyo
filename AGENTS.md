## Project

Homebridge dynamic platform plugin (`@jabrown93/homebridge-onkyo`) that exposes Onkyo / Integra AV receivers to HomeKit over the eISCP (Integra Serial Communication Protocol over Ethernet, TCP port 60128). ESM, Node 24, TypeScript strict mode.

The repo's own README declares the plugin is not actively maintained beyond dependency updates — most PRs landing on `main` are Renovate updates. Code changes should stay minimal and targeted.

## Common commands

- `npm run build` — clean + `tsc` to `dist/`. Homebridge loads `dist/index.js`.
- `npm run typecheck` (alias `npm run tsc`) — `tsc --noEmit`.
- `npm run lint` / `npm run lint:fix` — ESLint over `src/**.ts`.
- `npm test` — runs `xo` (lint-only; there are no unit tests).
- `npm run format` / `npm run prettier` — Prettier write / check.
- `npm run watch` — copies `test/hbConfig/config-template.json` to `config.json` if missing, builds, `npm link`s the plugin, and runs Homebridge against `test/hbConfig` via nodemon. Live-reloads on changes to `src/` or that config. Edit `test/hbConfig/config.json` with a real receiver IP before use.

Releases are driven by `semantic-release` from Conventional Commits on `main` (see `.releaserc.json`, `commitlint.config.js`, and `.github/workflows/release.yml`). Don't hand-edit `CHANGELOG.md` or the version in `package.json`.

## Architecture

Entry flow:

1. `src/index.ts` registers `OnkyoPlatform` under `PLATFORM_NAME` from `src/settings.ts`. **The pluginAlias is `OnkyoReceiverPlatform`** (matches `config.schema.json`). The README's `"platform": "Onkyo"` example is stale — use `OnkyoReceiverPlatform` when editing `test/hbConfig/config.json`.
2. `OnkyoPlatform` (`src/onkyoPlatform.ts`) is a `DynamicPlatformPlugin`. On `didFinishLaunching` it iterates `config.receivers`, opens **one shared `Eiscp` connection per `ip_address`** (cached in `this.connections`), and constructs one `OnkyoReceiver` per entry. Accessory UUIDs are derived from `'homebridge:homebridge-onkyo' + receiver.name`; cached accessories arrive via `configureAccessory` and are reused.
3. `OnkyoReceiver` (`src/onkyoReceiver.ts`) owns all HomeKit services for one receiver: a `Television` service with `InputSource` children, a `TelevisionSpeaker`, optional `Lightbulb` dimmer and `Fan` speed services for volume, plus an `AccessoryInformation` service. It maintains in-memory state (`state`, `m_state`, `v_state`, `i_state`) and uses `polling-to-event` to poll the receiver when `poll_status_interval` is set. The `cmdMap: CommandZones` selects `main` vs `zone2` eISCP command prefixes.
4. `src/eiscp/` is a vendored, lightly TypeScript-ified copy of [untitledlt/eiscp.js](https://github.com/untitledlt/eiscp.js) — **not** an npm dependency, and **not** covered by this repo's license (see `src/eiscp/LICENSE`). It bundles `eiscp-commands.json` (every supported command/model/value mapping) and exposes the EventEmitter-based `Eiscp` client used by the platform. Treat this folder as third-party: avoid stylistic refactors, and only touch it for genuine bugs or new command support. `xo` and several ESLint rules already ignore it.

Config typing lives in `src/receiverConfig.ts` and `src/receiverInputConfig.ts`; the user-facing schema (and the source of truth for valid `model` values and option docs) is `config.schema.json`, consumed by homebridge-config-ui-x.

## Conventions worth knowing

- ESM only (`"type": "module"`). Local imports must use `.js` extensions even from `.ts` files — TS `nodenext` resolution requires it.
- Conventional Commits are enforced by commitlint + Husky `commit-msg` hook; non-conforming messages will be rejected and will also break the release pipeline.
- `lint-staged` runs ESLint (with `--max-warnings=0`) and Prettier on staged files via the Husky `pre-commit` hook.
- The `src/eiscp/` directory is exempt from `xo` (`xo.ignores`) and contains snake_case identifiers and legacy patterns on purpose — don't "fix" them.
- Node engine supports `^22.12.0 || ^24.11.0 || ^26.0.0`; Homebridge peer range is `^1.8.0 || ^2.0.0-beta.0` (1.x is deprecated and will be dropped in a future major release).
