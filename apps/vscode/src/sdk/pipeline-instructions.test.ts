import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { parseConfiguredAgentConfig } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadPipelineInstructions, renderPipelineInstructions, resolvePipelineBindings } from "./pipeline-instructions"

describe("resolvePipelineBindings", () => {
	it("resolves all four pipeline stages to their exact subagent tool names", () => {
		const result = resolvePipelineBindings([
			{ name: "planner" },
			{ name: "generator" },
			{ name: "reviewer" },
			{ name: "editor" },
		])
		expect(result.warnings).toEqual([])
		expect(result.bindings).toEqual([
			{ stage: "planner", agentName: "planner", toolName: "subagent_planner" },
			{ stage: "generator", agentName: "generator", toolName: "subagent_generator" },
			{ stage: "reviewer", agentName: "reviewer", toolName: "subagent_reviewer" },
			{ stage: "editor", agentName: "editor", toolName: "subagent_editor" },
		])
	})

	it("skips missing profiles with a warning and keeps the rest", () => {
		const result = resolvePipelineBindings([{ name: "planner" }, { name: "reviewer" }])
		expect(result.bindings.map((b) => b.stage)).toEqual(["planner", "reviewer"])
		expect(result.warnings).toHaveLength(2)
		expect(result.warnings[0]).toContain('"generator"')
		expect(result.warnings[1]).toContain('"editor"')
	})

	it("returns no bindings and warns when no pipeline profiles exist", () => {
		const result = resolvePipelineBindings([{ name: "unrelated-agent" }])
		expect(result.bindings).toEqual([])
		expect(result.warnings).toHaveLength(4)
	})

	it("matches profile names case-insensitively like the SDK loader", () => {
		const result = resolvePipelineBindings([{ name: "Planner" }, { name: "EDITOR" }])
		expect(result.bindings.map((b) => b.toolName)).toEqual(["subagent_planner", "subagent_editor"])
	})

	it("ignores look-alike profile names that are not exact stage names", () => {
		// "Planner!" is a distinct profile that no stage looks up; the four
		// canonical stages still resolve normally and no false collision is
		// reported. (Inter-stage tool-name collisions are impossible because
		// stage names are fixed and distinct; the collision guard in the
		// implementation is defensive only.)
		const result = resolvePipelineBindings([
			{ name: "planner" },
			{ name: "Planner!" },
			{ name: "generator" },
			{ name: "reviewer" },
			{ name: "editor" },
		])
		expect(result.warnings).toEqual([])
		expect(result.bindings.map((b) => b.stage)).toEqual(["planner", "generator", "reviewer", "editor"])
		expect(result.bindings.map((b) => b.toolName)).toEqual([
			"subagent_planner",
			"subagent_generator",
			"subagent_reviewer",
			"subagent_editor",
		])
	})
})

describe("renderPipelineInstructions", () => {
	const allStages = resolvePipelineBindings([
		{ name: "planner" },
		{ name: "generator" },
		{ name: "reviewer" },
		{ name: "editor" },
	]).bindings

	it("returns undefined when no stages are bound", () => {
		expect(renderPipelineInstructions([])).toBeUndefined()
	})

	it("renders the full four-stage sequence with exact tool names", () => {
		const text = renderPipelineInstructions(allStages)
		expect(text).toBeDefined()
		for (const toolName of ["subagent_planner", "subagent_generator", "subagent_reviewer", "subagent_editor"]) {
			expect(text).toContain(toolName)
		}
		// Mandatory behaviors from the spec:
		expect(text).toContain("NEVER claim a stage succeeded merely because you called its tool")
		expect(text).toContain("Do NOT retry a failed stage more than once")
		expect(text).toContain("At most ONE additional review/correction cycle")
		expect(text).toContain("MUST NOT use the pipeline")
		expect(text).toContain("per-edit approval")
	})

	it("renders a partial pipeline when only some stages are bound", () => {
		const partial = resolvePipelineBindings([{ name: "planner" }, { name: "generator" }]).bindings
		const text = renderPipelineInstructions(partial)
		expect(text).toContain("Partial pipeline")
		expect(text).toContain("subagent_planner")
		expect(text).toContain("subagent_generator")
		expect(text).not.toContain("subagent_reviewer")
		expect(text).not.toContain("Full pipeline sequence")
	})
})

describe("loadPipelineInstructions (filesystem)", () => {
	let tempRoot: string
	let workspaceRoot: string
	let previousClineDir: string | undefined

	beforeEach(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-instructions-"))
		// Isolate BOTH loader search paths: workspace .cline/agents and the
		// user-level ~/.cline/agents (redirected via CLINE_DIR) so the tests
		// never see the developer's real profiles.
		previousClineDir = process.env.CLINE_DIR
		process.env.CLINE_DIR = path.join(tempRoot, "user-cline")
		workspaceRoot = path.join(tempRoot, "workspace")
		fs.mkdirSync(path.join(workspaceRoot, ".cline", "agents"), { recursive: true })
	})

	afterEach(() => {
		process.env.CLINE_DIR = previousClineDir
		fs.rmSync(tempRoot, { recursive: true, force: true })
	})

	function writeProfile(name: string, content: string): void {
		fs.writeFileSync(path.join(workspaceRoot, ".cline", "agents", `${name}.yaml`), content, "utf8")
	}

	it("loads the real bundled templates and renders the full pipeline", () => {
		const templatesDir = path.resolve(__dirname, "../../resources/pipeline-agents")
		for (const file of ["planner.yaml", "generator.yaml", "reviewer.yaml", "editor.yaml"]) {
			fs.copyFileSync(path.join(templatesDir, file), path.join(workspaceRoot, ".cline", "agents", file))
		}
		const result = loadPipelineInstructions(workspaceRoot)
		expect(result.warnings).toEqual([])
		expect(result.bindings.map((b) => b.stage)).toEqual(["planner", "generator", "reviewer", "editor"])
		expect(result.instructions).toContain("Full pipeline sequence")
		expect(result.instructions).toContain("subagent_planner")
	})

	it("returns no instructions and four warnings when no profiles exist", () => {
		const result = loadPipelineInstructions(workspaceRoot)
		expect(result.instructions).toBeUndefined()
		expect(result.bindings).toEqual([])
		expect(result.warnings).toHaveLength(4)
	})

	it("surfaces malformed profiles as warnings and still binds valid stages", () => {
		writeProfile(
			"planner",
			"---\nname: planner\ndescription: ok\n---\nYou plan.",
		)
		// Missing required `description` frontmatter -> parse error.
		writeProfile("generator", "---\nname: generator\n---\nBroken.")
		const result = loadPipelineInstructions(workspaceRoot)
		expect(result.bindings.map((b) => b.stage)).toEqual(["planner"])
		expect(result.instructions).toContain("Partial pipeline")
		expect(result.warnings.some((w) => w.includes("generator.yaml"))).toBe(true)
	})

	it("bundled templates parse and enforce read-only tool allowlists for planner/reviewer", () => {
		const templatesDir = path.resolve(__dirname, "../../resources/pipeline-agents")
		const parsed: Record<string, { tools?: string[]; providerId?: string; modelId?: string; maxIterations?: number }> = {}
		for (const file of ["planner.yaml", "generator.yaml", "reviewer.yaml", "editor.yaml"]) {
			const content = fs.readFileSync(path.join(templatesDir, file), "utf8")
			const config = parseConfiguredAgentConfig(content, { path: file })
			parsed[config.name] = config
		}
		expect(Object.keys(parsed).sort()).toEqual(["editor", "generator", "planner", "reviewer"])

		// Read-only enforcement lives in the tool allowlist, not the prompt.
		for (const readOnlyStage of ["planner", "reviewer"]) {
			const tools = parsed[readOnlyStage].tools ?? []
			expect(tools).not.toContain("editor")
			expect(tools).not.toContain("apply_patch")
			expect(tools).not.toContain("run_commands")
			expect(tools).toContain("read_files")
			expect(tools).toContain("search_codebase")
			expect(tools).toContain("submit_and_exit")
		}

		// Editing stages get mutation tools.
		for (const editingStage of ["generator", "editor"]) {
			const tools = parsed[editingStage].tools ?? []
			expect(tools).toContain("editor")
			expect(tools).toContain("apply_patch")
		}

		// Defaults from the spec: Ollama + Qwen Coder, bounded iterations.
		expect(parsed.planner.providerId).toBe("ollama")
		expect(parsed.planner.modelId).toBe("qwen3-coder:30b")
		expect(parsed.planner.maxIterations).toBe(8)
		expect(parsed.generator.providerId).toBe("ollama")
		expect(parsed.generator.modelId).toBe("qwen3-coder:7b")
		expect(parsed.generator.maxIterations).toBe(12)
		expect(parsed.reviewer.providerId).toBe("ollama")
		expect(parsed.reviewer.modelId).toBe("qwen3-coder:30b")
		expect(parsed.reviewer.maxIterations).toBe(8)
		expect(parsed.editor.providerId).toBe("ollama")
		expect(parsed.editor.modelId).toBe("qwen3-coder:7b")
		expect(parsed.editor.maxIterations).toBe(10)

		// Structured output contracts are present in the prompts.
		const plannerPrompt = fs.readFileSync(path.join(templatesDir, "planner.yaml"), "utf8")
		expect(plannerPrompt).toContain("<<<PLAN")
		const reviewerPrompt = fs.readFileSync(path.join(templatesDir, "reviewer.yaml"), "utf8")
		expect(reviewerPrompt).toContain("APPROVED")
		expect(reviewerPrompt).toContain("<<<FINDINGS")
	})
})
