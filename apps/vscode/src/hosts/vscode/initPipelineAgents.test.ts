import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { copyPipelineAgentTemplates, PIPELINE_AGENT_FILES } from "./initPipelineAgents"

describe("copyPipelineAgentTemplates", () => {
	let tempRoot: string
	let templatesDir: string
	let targetDir: string

	beforeEach(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "init-pipeline-agents-"))
		templatesDir = path.join(tempRoot, "templates")
		targetDir = path.join(tempRoot, "workspace", ".cline", "agents")
		await fs.mkdir(templatesDir, { recursive: true })
		// Seed minimal templates (the real bundled ones are validated by
		// pipeline-instructions.test.ts; this suite tests copy semantics).
		for (const file of PIPELINE_AGENT_FILES) {
			const name = file.replace(".yaml", "")
			await fs.writeFile(
				path.join(templatesDir, file),
				`---\nname: ${name}\ndescription: test ${name}\n---\nYou are the ${name}.`,
				"utf8",
			)
		}
	})

	afterEach(async () => {
		await fs.rm(tempRoot, { recursive: true, force: true })
	})

	it("installs all four templates into an empty agents directory", async () => {
		const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting: false })
		expect(result.copied.sort()).toEqual([...PIPELINE_AGENT_FILES].sort())
		expect(result.skippedExisting).toEqual([])
		expect(result.overwritten).toEqual([])
		expect(result.malformed).toEqual([])
		for (const file of PIPELINE_AGENT_FILES) {
			await expect(fs.access(path.join(targetDir, file))).resolves.toBeUndefined()
		}
	})

	it("keeps existing profiles without explicit overwrite", async () => {
		await fs.mkdir(targetDir, { recursive: true })
		await fs.writeFile(path.join(targetDir, "planner.yaml"), "---\nname: planner\ndescription: custom\n---\nCustom.", "utf8")
		const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting: false })
		expect(result.skippedExisting).toEqual(["planner.yaml"])
		expect(result.copied).toHaveLength(3)
		const kept = await fs.readFile(path.join(targetDir, "planner.yaml"), "utf8")
		expect(kept).toContain("Custom.")
	})

	it("overwrites existing profiles when overwriteExisting is true", async () => {
		await fs.mkdir(targetDir, { recursive: true })
		await fs.writeFile(path.join(targetDir, "planner.yaml"), "---\nname: planner\ndescription: custom\n---\nCustom.", "utf8")
		const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting: true })
		expect(result.overwritten).toEqual(["planner.yaml"])
		expect(result.copied).toHaveLength(3)
		const replaced = await fs.readFile(path.join(targetDir, "planner.yaml"), "utf8")
		expect(replaced).toContain("You are the planner.")
	})

	it("reports a missing bundled template as malformed and continues with the rest", async () => {
		await fs.rm(path.join(templatesDir, "editor.yaml"))
		const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting: false })
		expect(result.copied).toHaveLength(3)
		expect(result.malformed).toHaveLength(1)
		expect(result.malformed[0].file).toContain("editor.yaml")
		expect(result.malformed[0].error).toContain("Bundled template missing")
	})

	it("flags malformed profiles on disk (copied or pre-existing)", async () => {
		// Corrupt one template: missing required description frontmatter.
		await fs.writeFile(path.join(templatesDir, "reviewer.yaml"), "---\nname: reviewer\n---\nBroken.", "utf8")
		const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting: false })
		expect(result.malformed).toHaveLength(1)
		expect(result.malformed[0].file).toContain("reviewer.yaml")
		// All four files are still installed (install-then-validate); the
		// malformed one is reported so the user can fix it.
		expect(result.copied).toHaveLength(4)
	})
})
