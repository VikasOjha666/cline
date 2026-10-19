import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveConfiguredAgentToolNames } from "./configured-agent-tools"

describe("resolveConfiguredAgentToolNames", () => {
	let tempRoot: string
	let workspaceRoot: string
	let previousClineDir: string | undefined

	beforeEach(() => {
		tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "configured-agent-tools-"))
		previousClineDir = process.env.CLINE_DIR
		process.env.CLINE_DIR = path.join(tempRoot, "user-cline")
		workspaceRoot = path.join(tempRoot, "workspace")
		fs.mkdirSync(path.join(workspaceRoot, ".cline", "agents"), { recursive: true })
	})

	afterEach(() => {
		process.env.CLINE_DIR = previousClineDir
		fs.rmSync(tempRoot, { recursive: true, force: true })
	})

	function writeProfile(name: string): void {
		fs.writeFileSync(
			path.join(workspaceRoot, ".cline", "agents", `${name}.yaml`),
			`---\nname: ${name}\ndescription: test ${name}\n---\nYou are the ${name}.`,
			"utf8",
		)
	}

	it("resolves the exact subagent_* tool names for the four pipeline profiles", () => {
		for (const name of ["planner", "generator", "reviewer", "editor"]) {
			writeProfile(name)
		}
		expect(resolveConfiguredAgentToolNames(workspaceRoot).sort()).toEqual([
			"subagent_editor",
			"subagent_generator",
			"subagent_planner",
			"subagent_reviewer",
		])
	})

	it("returns an empty list when no profiles exist", () => {
		expect(resolveConfiguredAgentToolNames(workspaceRoot)).toEqual([])
	})

	it("still resolves readable profiles when one file is malformed", () => {
		writeProfile("planner")
		fs.writeFileSync(
			path.join(workspaceRoot, ".cline", "agents", "broken.yaml"),
			"---\nname: broken\n---\nMissing description.",
			"utf8",
		)
		expect(resolveConfiguredAgentToolNames(workspaceRoot)).toEqual(["subagent_planner"])
	})
})