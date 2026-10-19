# Cline Pipeline Edition — Multi-Model Local Coding Pipeline

Cline Pipeline Edition is a fork of the Cline VS Code extension that runs a **four-stage
multi-model coding pipeline** inside a single Act-mode task, using configured sub-agents
backed by local Ollama models.

## The pipeline

| Stage | Agent tool | Default model | Tools | Purpose |
|---|---|---|---|---|
| Planner | `subagent_planner` | `qwen3-coder:30b` | read-only (files + search) | Explore the codebase and produce a structured implementation plan |
| Generator | `subagent_generator` | `qwen3:8b` | read, search, edit, patch, run | Implement the plan with real file edits |
| Reviewer | `subagent_reviewer` | `qwen3-coder:30b` | read-only (files + search) | Review the actual changes; return numbered findings or `APPROVED` |
| Editor | `subagent_editor` | `qwen3:8b` | read, search, edit, patch, run | Apply review findings |

The main session (orchestrator, recommended `qwen3-coder:30b`) drives the stages
prompt-first: it calls each sub-agent in order, stops when a stage fails, and never
claims a stage succeeded merely because its tool was called. The workflow is defined in
instructions injected into Act-mode sessions when configured sub-agents are enabled —
there is no hard-coded state machine.

The 30B planner/reviewer and 8B generator/editor split has been verified end-to-end with
live Ollama: the planner and reviewer reason about the codebase with the larger model,
while the generator and editor perform the actual edits with the smaller, faster model.

## Initialization

1. Open the command palette (`Ctrl+Shift+P`).
2. Run **"Cline Pipeline Edition: Initialize Pipeline Agent Profiles"**.
3. Four YAML profiles are copied into `.cline/agents/` in your workspace (only files that
   do not already exist are created — existing profiles are never overwritten):

   - `.cline/agents/planner.yaml`
   - `.cline/agents/generator.yaml`
   - `.cline/agents/reviewer.yaml`
   - `.cline/agents/editor.yaml`

4. Edit the `providerId`/`modelId` fields to match the tags shown by `ollama list` on
   **your** machine. The shipped defaults are examples — the small-model tags in
   particular are easy to get wrong (`qwen3-coder:7b` does not exist upstream).
5. Reload the window so the next task picks up the profiles (agent profiles are loaded
   at session start).

Malformed or missing profiles are reported clearly in the Cline view when a pipeline task
starts; the orchestrator names the exact missing tool (`subagent_planner`, …) and how to
fix it.

## Configuration

- `cline.enableConfiguredSubagents` (default `true` in this fork) — master switch for
  configured sub-agent spawning. When disabled, no `subagent_*` tools are registered and
  no pipeline instructions are injected.
- Per-agent `maxIterations` in each YAML profile bounds how many steps a stage may take.
  Weak local models cannot loop forever.
- Models, providers and iteration limits are all user-editable in the YAML profiles.

## Delegation and approval — read this

Approving a **delegation** (a `subagent_*` tool call) allows the child agent to perform
**multiple file operations autonomously** until it finishes or hits its iteration limit.
It is *not* the same as approving each individual file edit. Child edits run without
per-edit confirmation prompts; your existing auto-approval settings do not change this.
Only approve delegations for tasks you would let an agent do unattended within the given
tool allowlist.

Read-only stages (planner, reviewer) are enforced through their **tool allowlists** —
they physically cannot call editing tools. The prompt alone is never the boundary.

## Cross-provider limitation (v1)

Configured sub-agents inherit the parent session's connection configuration (base URL,
credentials) and only override provider/model IDs. In practice this means all four
stages should use the **same provider** (e.g. Ollama) as the main session. Do not put
API keys or other secrets in agent YAML. Resolving a separate provider's credentials per
agent is a documented future integration point, not implemented in v1.

## Context passing

Child agents do not inherit the parent conversation. The orchestrator instructions
require passing the complete original task plus the relevant plan/findings text to each
stage explicitly, so a compacted parent session does not starve the stages.

## Checkpoints

Checkpoints are Git-based and snapshot the shared working directory. Child-agent edits
happen in the same working tree, so they are included in checkpoint snapshots taken
after delegation completes — but there is no per-stage rollback granularity. Verify
critical state before relying on rollback.

## Model routing evidence

The live verification harness (`tmp/pipeline-live-harness.ts` in the development tree)
records the `model` field of every request the runtime sends to Ollama and asserts that
planner/reviewer requests carry only the 30B model and generator/editor requests carry
only the small model. The verified run completed all four stages with independent
functional verification of the produced code.

See the fork README for installation, branding and packaging notes.
