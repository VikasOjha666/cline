# Cline Pipeline Edition

A fork of [Cline](https://github.com/cline/cline) that adds a **multi-model coding pipeline**: four configured sub-agents (Planner -> Generator -> Reviewer -> Editor), each backed by a different local Ollama model, orchestrated inside a single Act-mode task by the main Cline session.

> This is an independent fork. It is not affiliated with, endorsed by, or connected to the official Cline project or its publisher. Upstream attribution and license notices (Apache-2.0) are preserved throughout.

## What it does

For substantive coding tasks in Act mode, the main Cline session (the orchestrator) delegates work through four configured sub-agents:

| Stage | Default model | Capabilities | Iteration limit |
| --- | --- | --- | --- |
| **Planner** (`subagent_planner`) | `qwen3-coder:30b` | Read-only: read files, search codebase | 8 |
| **Generator** (`subagent_generator`) | `qwen3:8b` | Reads, edits, patches, runs commands | 12 |
| **Reviewer** (`subagent_reviewer`) | `qwen3-coder:30b` | Read-only: read files, search codebase | 8 |
| **Editor** (`subagent_editor`) | `qwen3:8b` | Reads, edits, patches, runs commands | 10 |

The orchestration is **prompt-driven**, not a hard-coded state machine: the pipeline instructions injected into the orchestrator's prompt tell it to call the stages in order, verify each stage's real output, and stop on failure. Simple questions and explanations skip the pipeline entirely.

Read-only behavior of the Planner and Reviewer is enforced by their **tool allowlists**, not by prompts - they have no editing or shell tools registered at all.

## Getting started

1. Install the extension (`.vsix`), e.g. `code --install-extension cline-pipeline-edition-0.1.0.vsix`. It installs alongside official Cline without conflicts (different extension ID and publisher).
2. Configure an **Ollama** provider in Cline settings with a working model (see below).
3. Run **"Cline Pipeline Edition: Initialize Pipeline Agents"** from the Command Palette. This copies four editable agent profiles into your workspace's `.cline/agents/` directory (`planner.yaml`, `generator.yaml`, `reviewer.yaml`, `editor.yaml`). With no workspace open it installs to `~/.cline/agents/` instead.
4. Start a task in **Act mode** and describe a coding change. The orchestrator will use the pipeline when the task warrants it.
### Changing models and providers

Each profile's YAML frontmatter controls which model it uses:

```yaml
---
name: planner
description: Explores the codebase and produces a structured implementation plan...
providerId: ollama
modelId: qwen3-coder:30b
maxIterations: 8
tools:
  - read_files
  - search_codebase
  - submit_and_exit
---
(system prompt body follows)
```

Edit `providerId`/`modelId` to point at whatever models you have installed (`ollama list` shows your tags). The defaults are examples - **do not assume `qwen3-coder:30b` or `qwen3:8b` exist on your machine**; edit these before first use if you run different models. Changes take effect on the next task (agent profiles are loaded at session start).

> **Same-provider requirement (v1):** configured sub-agents inherit the parent session's connection configuration (API key, base URL, headers). Only `providerId`/`modelId` are overridden per profile, and they must resolve within the parent's provider connection (e.g. any model served by your local Ollama). Cross-provider credential resolution is a documented future integration point, not implemented in this MVP. Never put API keys or other secrets in agent YAML - they are plain files typically committed to your repo's `.cline/` directory.

### Initialization safety

The "Initialize Pipeline Agents" command **never overwrites** existing profiles without explicit confirmation. Existing files are kept and re-validated; malformed YAML is reported in the "Cline Pipeline Edition" output channel with the exact file and parse error.

## Approving delegations

When the orchestrator calls a `subagent_*` tool, you approve the **delegation once**. The approved sub-agent then performs **multiple file reads, edits, and command executions autonomously** (bounded by its tool allowlist and `maxIterations`) without further per-edit prompts. This is noisier than a single file edit: approving one delegation can mean many changes.

- The Planner and Reviewer sub-agents are read-only by construction (tool allowlist).
- The Generator and Editor sub-agents can modify files and run shell commands within their allowlists.
- Existing auto-approval settings do not silently apply to delegations: `subagent_*` tools always require explicit approval regardless of auto-approve configuration.
- Git checkpoints (when enabled) snapshot the workspace at task start; child-agent edits happen in the same working tree and are covered by the same checkpoint/rollback cycle. See "Known limitations" before relying on rollback.

## The `enableConfiguredSubagents` setting

A new setting, **Enable Configured Sub-Agents** (default: **on** in this fork), controls the whole feature:

- **On:** Act-mode sessions expose the `subagent_*` tools for profiles found in `.cline/agents/` and receive the pipeline orchestrator instructions.
- **Off:** no delegation tools, no pipeline instructions - plain single-model Cline behavior.
- Plan mode never exposes delegation tools or pipeline instructions, regardless of the setting.

The setting takes effect on the next session/task; an in-flight task is not rebuilt.

## What works offline / what needs network

- **Fully local:** inference through Ollama, agent profile loading, the pipeline orchestration itself.
- **Network-dependent (upstream features, unchanged):** account sign-in, model marketplace/catalog refresh, telemetry (respect your telemetry setting), MCP marketplace, web fetching/search tools.

## Known limitations (v1)

- **Approval autonomy:** approving a delegation allows the child agent to execute all tools in its allowlist autonomously. There is no per-edit review of child output; review happens at the Reviewer stage instead.
- **Same-provider agents only:** see above. Agent YAML cannot carry credentials.
- **Data isolation:** this fork keeps the upstream `~/.cline` data directory (sessions, settings, MCP config, caches) by default. Running this fork alongside official Cline **shares** that state unless you set the `CLINE_DIR` environment variable to a separate directory for the fork's host process. Verify all subsystems honor your chosen directory before assuming isolation.
- **Checkpoints/rollback:** checkpoints are created for the root task working tree; child-agent edits land in the same tree between checkpoints. A rollback restores the pre-task state, reverting child edits made after the task started - but validate rollback on a disposable repo before relying on it.
- **Context isolation:** each sub-agent sees only the prompt the orchestrator sends it - the parent conversation and compaction history are not shared. The pipeline instructions require passing the original task and plan/findings explicitly.
- **Iteration limits:** weak local models may loop or terminate early. Each profile has a bounded `maxIterations`; the orchestrator is instructed to stop and surface failures rather than retry unboundedly.
- **Generic `spawn_agent` tool:** enabling configured sub-agents does not expose the generic upstream `spawn_agent` tool in the VS Code host (no `createSpawnTool` is supplied); only your `subagent_*` tools are available.

## Attribution

This fork is derived from [Cline](https://github.com/cline/cline) (Apache-2.0). See the repository's `LICENSE` and source headers. It builds on Cline's configured-agent/SDK infrastructure; any attribution and license notices in the source and distribution files remain intact.
