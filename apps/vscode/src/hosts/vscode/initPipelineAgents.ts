import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { parseConfiguredAgentConfig } from "@cline/core"

/**
 * Fork feature (Cline Pipeline Edition): "Initialize Pipeline Agents" command.
 *
 * Copies the bundled pipeline agent templates (planner/generator/reviewer/
 * editor) from the extension's resources into the workspace's
 * `.cline/agents/` directory, which is one of the search paths of the
 * existing configured-agent loader (resolveAgentConfigSearchPaths).
 *
 * Safety rules:
 * - Never overwrites an existing profile without explicit confirmation.
 * - Validates each copied (or existing) profile with the real parser and
 *   reports malformed files clearly.
 * - Works with no workspace open by falling back to the user-level agents
 *   directory (~/.cline/agents) — the loader's second search path.
 */

export const PIPELINE_AGENT_FILES = ["planner.yaml", "generator.yaml", "reviewer.yaml", "editor.yaml"] as const

export interface InitPipelineAgentsResult {
	targetDir: string
	copied: string[]
	skippedExisting: string[]
	overwritten: string[]
	malformed: Array<{ file: string; error: string }>
}

/**
 * Pure-ish core of the command: copies templates from `templatesDir` into
 * `targetDir`, honoring `overwriteExisting`. Profiles are then parsed with the
 * real configured-agent parser to surface malformed YAML. Exported for tests;
 * the VS Code command wrapper adds UI (dialogs, output channel).
 */
export async function copyPipelineAgentTemplates(options: {
	templatesDir: string
	targetDir: string
	overwriteExisting: boolean
}): Promise<InitPipelineAgentsResult> {
	const { templatesDir, targetDir, overwriteExisting } = options
	const result: InitPipelineAgentsResult = {
		targetDir,
		copied: [],
		skippedExisting: [],
		overwritten: [],
		malformed: [],
	}

	await fs.mkdir(targetDir, { recursive: true })

	for (const file of PIPELINE_AGENT_FILES) {
		const source = path.join(templatesDir, file)
		const target = path.join(targetDir, file)
		let content: string
		try {
			content = await fs.readFile(source, "utf8")
		} catch (error) {
			result.malformed.push({
				file: source,
				error: `Bundled template missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
			})
			continue
		}

		let targetExists = false
		try {
			await fs.access(target)
			targetExists = true
		} catch {
			targetExists = false
		}

		if (targetExists && !overwriteExisting) {
			result.skippedExisting.push(file)
		} else {
			await fs.writeFile(target, content, "utf8")
			if (targetExists) {
				result.overwritten.push(file)
			} else {
				result.copied.push(file)
			}
		}

		// Validate the profile as it now exists on disk (copied or pre-existing).
		try {
			const onDisk = await fs.readFile(target, "utf8")
			parseConfiguredAgentConfig(onDisk, { path: target })
		} catch (error) {
			result.malformed.push({ file: target, error: error instanceof Error ? error.message : String(error) })
		}
	}

	return result
}

/**
 * Resolve the target agents directory: `<workspace>/.cline/agents` when a
 * workspace folder is open, otherwise the user-level `~/.cline/agents`
 * (via CLINE_DIR, matching the loader's search paths).
 */
export function resolveTargetAgentsDir(): { targetDir: string; scope: "workspace" | "user" } {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
	if (workspaceFolder) {
		return { targetDir: path.join(workspaceFolder.uri.fsPath, ".cline", "agents"), scope: "workspace" }
	}
	const clineDir = process.env.CLINE_DIR ?? path.join(os.homedir(), ".cline")
	return { targetDir: path.join(clineDir, "agents"), scope: "user" }
}

export async function initializePipelineAgents(extensionPath: string): Promise<void> {
	const templatesDir = path.join(extensionPath, "resources", "pipeline-agents")
	const { targetDir, scope } = resolveTargetAgentsDir()

	const scopeNote =
		scope === "workspace"
			? `Workspace agents directory: ${targetDir}`
			: `No workspace open — installing to your user agents directory: ${targetDir} (available in every workspace)`

	// If any target profile already exists, ask before overwriting.
	const existing: string[] = []
	for (const file of PIPELINE_AGENT_FILES) {
		try {
			await fs.access(path.join(targetDir, file))
			existing.push(file)
		} catch {
			// does not exist
		}
	}

	let overwriteExisting = false
	if (existing.length > 0) {
		const choice = await vscode.window.showWarningMessage(
			`Cline Pipeline Edition: ${existing.length} pipeline agent profile(s) already exist (${existing.join(", ")}). Overwrite them with the bundled templates? ` +
				"Your custom model IDs and prompts in those files will be lost. Cancel keeps your files.",
			{ modal: true },
			"Overwrite",
		)
		if (choice !== "Overwrite") {
			// Proceed in copy mode: existing files are skipped, new ones installed.
			overwriteExisting = false
		} else {
			overwriteExisting = true
		}
	}

	const result = await copyPipelineAgentTemplates({ templatesDir, targetDir, overwriteExisting })

	const output = vscode.window.createOutputChannel("Cline Pipeline Edition")
	output.clear()
	output.appendLine(`Pipeline agent profiles (${scope} scope): ${targetDir}`)
	output.appendLine(scopeNote)
	output.appendLine("")
	for (const file of result.copied) {
		output.appendLine(`+ installed ${file}`)
	}
	for (const file of result.overwritten) {
		output.appendLine(`~ overwritten ${file}`)
	}
	for (const file of result.skippedExisting) {
		output.appendLine(`= kept existing ${file} (not overwritten)`)
	}
	if (result.malformed.length > 0) {
		output.appendLine("")
		output.appendLine("PROBLEMS:")
		for (const problem of result.malformed) {
			output.appendLine(`! ${problem.file}: ${problem.error}`)
		}
	}
	output.appendLine("")
	output.appendLine("Edit the providerId/modelId/maxIterations frontmatter of each profile to match your local models.")
	output.appendLine("NOTE: approving a delegation lets a sub-agent run multiple file operations autonomously.")
	output.show(true)

	if (result.malformed.length > 0) {
		vscode.window.showErrorMessage(
			`Cline Pipeline Edition: ${result.malformed.length} agent profile(s) are malformed — see the "Cline Pipeline Edition" output channel.`,
		)
	} else {
		vscode.window.showInformationMessage(
			`Cline Pipeline Edition: pipeline agents ready (${result.copied.length + result.skippedExisting.length + result.overwritten.length} profiles in ${targetDir}).`,
		)
	}
}
