// Fork feature (Cline Pipeline Edition): builds the orchestrator instructions
// that drive the configured-sub-agent pipeline (planner -> generator ->
// reviewer -> editor) inside a single act-mode session.
//
// The instructions are PROMPT-DRIVEN, not a hard-coded state machine: the main
// model decides when a task is substantive enough for the pipeline and calls
// the `subagent_*` tools in order. The tool names are derived from the SAME
// loader the SDK core uses at runtime (loadConfiguredAgentConfigs +
// buildConfiguredAgentToolName), so the instructions never reference a tool
// that does not exist, and missing/colliding profiles degrade gracefully.

import { buildConfiguredAgentToolName, loadConfiguredAgentConfigs } from "@cline/core"
import { Logger } from "@shared/services/Logger"

/** Canonical pipeline stage order and the agent profile name each stage uses. */
export const PIPELINE_STAGES = [
	{ stage: "planner", agentName: "planner", role: "explore the codebase and produce an implementation plan (read-only)" },
	{
		stage: "generator",
		agentName: "generator",
		role: "implement the plan by writing/editing code (can modify files)",
	},
	{
		stage: "reviewer",
		agentName: "reviewer",
		role: "review the current changes against the task and plan, report actionable findings (read-only)",
	},
	{ stage: "editor", agentName: "editor", role: "apply the review findings (can modify files)" },
] as const

export interface PipelineStageBinding {
	stage: (typeof PIPELINE_STAGES)[number]["stage"]
	agentName: string
	/** Exact tool name the SDK will expose for this profile (subagent_<name>). */
	toolName: string
}

export interface PipelineInstructionsResult {
	/** Instructions text to append to the act-mode system prompt, or undefined. */
	instructions?: string
	/** Stage bindings that resolved to a real, uniquely-named profile. */
	bindings: PipelineStageBinding[]
	/** Human-readable problems (missing profiles, malformed YAML, collisions). */
	warnings: string[]
}

/**
 * Resolve the pipeline stages against the configured-agent profiles actually
 * present in the search paths (<workspace>/.cline/agents + ~/.cline/agents).
 *
 * Pure function over the loader so it is unit-testable; `loadPipelineInstructions`
 * wraps it with the real filesystem loader.
 */
export function resolvePipelineBindings(agents: Array<{ name: string }>): PipelineInstructionsResult {
	const warnings: string[] = []
	const bindings: PipelineStageBinding[] = []

	// loadConfiguredAgentConfigs keys by lowercased name and keeps the FIRST
	// profile for a name (workspace wins over user dir). Mirror that here.
	const byName = new Map<string, { name: string }>()
	for (const agent of agents) {
		const key = agent.name.trim().toLowerCase()
		if (!byName.has(key)) {
			byName.set(key, agent)
		}
	}

	// Detect tool-name collisions across DIFFERENT profiles: the SDK's
	// buildConfiguredAgentToolDescriptors de-duplicates colliding tool names
	// with numeric suffixes, which would make our instructions name the wrong
	// tool. If any pipeline profile collides, we drop it and warn.
	const pipelineToolNames = new Map<string, string>()
	for (const { stage, agentName } of PIPELINE_STAGES) {
		const profile = byName.get(agentName)
		if (!profile) {
			warnings.push(
				`Pipeline stage "${stage}": no agent profile named "${agentName}" found in .cline/agents/ (skipping this stage).`,
			)
			continue
		}
		const toolName = buildConfiguredAgentToolName(profile.name)
		const owner = pipelineToolNames.get(toolName)
		if (owner !== undefined) {
			warnings.push(
				`Pipeline stage "${stage}": tool name "${toolName}" collides with stage "${owner}"; skipping this stage to avoid delegating to the wrong agent.`,
			)
			continue
		}
		pipelineToolNames.set(toolName, stage)
		bindings.push({ stage, agentName: profile.name, toolName })
	}

	return { bindings, warnings }
}

/**
 * Build the orchestrator instructions for the resolved bindings, or undefined
 * when no pipeline stages are available (all profiles missing).
 */
export function renderPipelineInstructions(bindings: PipelineStageBinding[]): string | undefined {
	if (bindings.length === 0) {
		return undefined
	}
	const byStage = new Map(bindings.map((b) => [b.stage, b]))
	const roleByStage = new Map(PIPELINE_STAGES.map((s) => [s.stage, s.role]))
	const planner = byStage.get("planner")
	const generator = byStage.get("generator")
	const reviewer = byStage.get("reviewer")
	const editor = byStage.get("editor")

	const lines: string[] = []
	lines.push("# Configured Sub-Agent Pipeline (Cline Pipeline Edition)")
	lines.push(
		"For SUBSTANTIVE coding tasks that change code, you can delegate work to configured sub-agents. " +
			"Simple questions, explanations, or lookups that need no code changes MUST NOT use the pipeline — answer directly.",
	)
	lines.push("")
	lines.push("## Delegation rules (mandatory)")
	lines.push(
		"- Each stage is a single tool call named exactly as given below. Passing the stage prompt is required — the sub-agent sees ONLY what you send; it does not share your conversation.",
	)
	lines.push(
		"- A stage SUCCEEDED only if its tool result reports success AND contains the required output (plan block, modified-files list, findings, or fix report). " +
			"NEVER claim a stage succeeded merely because you called its tool. If a tool call errors, times out, hits its iteration limit, or returns no usable output, STOP the pipeline and report the stage's actual failure text to the user. " +
			"NEVER pass incomplete or failed output forward as if it succeeded.",
	)
	lines.push("- Do NOT retry a failed stage more than once. There is no unbounded retrying; surface the failure and stop.")
	lines.push(
		"- IMPORTANT: approving a delegation lets the sub-agent run multiple file operations autonomously. " +
			"The user approves the delegation once — they do NOT get a per-edit approval. Only delegate when the task warrants it.",
	)

	if (planner && generator && reviewer && editor) {
		lines.push("")
		lines.push("## Full pipeline sequence (four stages)")
		lines.push(
			`1. Call \`${planner.toolName}\` with the COMPLETE original task plus any relevant context. ${capitalize(roleByStage.get("planner") ?? "")}.`,
		)
		lines.push(
			"   Wait for its result. If it fails or contains no clearly delimited machine-readable plan block, stop and report the failure — do not continue.",
		)
		lines.push(
			`2. Call \`${generator.toolName}\` with the original task AND the full plan text from stage 1. ${capitalize(roleByStage.get("generator") ?? "")}.`,
		)
		lines.push(
			"   Verify its result lists modified files and reports success. If it failed or implemented nothing, stop and report the failure — do not proceed as though code was written.",
		)
		lines.push(
			`3. Call \`${reviewer.toolName}\` with the original task, the plan, and instructions to review the ACTUAL current changes (it inspects files and git state itself). ${capitalize(roleByStage.get("reviewer") ?? "")}.`,
		)
		lines.push(
			'   Wait for its numbered findings. If its result is exactly "APPROVED" (no actionable findings), skip the editor stage and summarize.',
		)
		if (editor) {
			lines.push(
				`4. If actionable findings exist, call \`${editor.toolName}\` with the original task plus the numbered findings verbatim. ${capitalize(roleByStage.get("editor") ?? "")}.`,
			)
			lines.push("   Verify its fix report (fixed / partially fixed / unresolved per finding).")
			lines.push(
				`5. OPTIONAL single re-review: call \`${reviewer.toolName}\` once more on the updated changes. ` +
					"At most ONE additional review/correction cycle is allowed in this configuration: if the second review still reports actionable findings, list them to the user and stop — do not loop.",
			)
		}
	} else {
		lines.push("")
		lines.push("## Partial pipeline")
		lines.push("Some pipeline profiles are not configured; only call the tools listed here:")
		for (const binding of bindings) {
			lines.push(`- \`${binding.toolName}\`: ${binding.agentName} — ${roleByStage.get(binding.stage) ?? ""}.`)
		}
		lines.push("Follow the same delegation rules above: verify real output, stop on failure, never fabricate success.")
	}

	lines.push("")
	lines.push("## Wrap-up (always)")
	lines.push(
		"After the pipeline completes (or stops early), summarize for the user: which stages actually ran, the real files changed, tests actually executed, review findings and their disposition, and any unresolved issues. Never report a test as run unless a stage's result shows it ran.",
	)
	return lines.join("\n")
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Load configured agents from disk and produce the instructions + warnings.
 * Any loader error degrades to "no instructions" with a warning rather than
 * failing session creation.
 */
export function loadPipelineInstructions(workspaceRoot?: string): PipelineInstructionsResult {
	try {
		const { configs, errors } = loadConfiguredAgentConfigs({ workspaceRoot })
		const resolved = resolvePipelineBindings(configs)
		for (const error of errors) {
			resolved.warnings.push(`Failed to load agent profile ${error.path}: ${error.error.message}`)
		}
		resolved.instructions = renderPipelineInstructions(resolved.bindings)
		return resolved
	} catch (error) {
		Logger.warn("[PipelineInstructions] Failed to load configured agents:", error)
		return {
			bindings: [],
			warnings: [`Failed to load configured agents: ${error instanceof Error ? error.message : String(error)}`],
		}
	}
}
