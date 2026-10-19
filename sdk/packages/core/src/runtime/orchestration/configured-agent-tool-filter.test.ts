import type { AgentTool } from "@cline/shared";
import { describe, expect, it } from "vitest";
import type { ConfiguredAgentConfig } from "../../extensions/tools/team/configured-agent-config";
import {
	filterToolsForConfiguredAgent,
	resolveConfiguredAgentToolName,
} from "./runtime-builder";

/**
 * Fork feature coverage (Cline Pipeline Edition): the four pipeline stages
 * rely on the configured-agent tool allowlist for their read-only guarantee.
 * An agent's prompt is NOT a security boundary — these tests assert the
 * delegated tool SET itself excludes editing tools for planner/reviewer.
 */

function makeTool(name: string): AgentTool {
	return {
		name,
		description: name,
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async () => ({ ok: true }),
	};
}

/** The full builtin tool universe a sub-agent could ever be granted. */
const ALL_TOOLS = [
	"read_files",
	"search_codebase",
	"run_commands",
	"fetch_web_content",
	"apply_patch",
	"editor",
	"skills",
	"ask_question",
	"submit_and_exit",
].map(makeTool);

function makeAgent(overrides: Partial<ConfiguredAgentConfig>): ConfiguredAgentConfig {
	return {
		name: "agent",
		description: "test",
		systemPrompt: "test",
		...overrides,
	};
}

describe("resolveConfiguredAgentToolName", () => {
	it("maps legacy/alternate names to canonical names", () => {
		expect(resolveConfiguredAgentToolName("write_to_file")).toBe("editor");
		expect(resolveConfiguredAgentToolName("replace_in_file")).toBe("editor");
		expect(resolveConfiguredAgentToolName("apply_diff")).toBe("editor");
		expect(resolveConfiguredAgentToolName("execute_command")).toBe("run_commands");
		expect(resolveConfiguredAgentToolName("bash")).toBe("run_commands");
		expect(resolveConfiguredAgentToolName("read_file")).toBe("read_files");
		expect(resolveConfiguredAgentToolName("search_files")).toBe("search_codebase");
		expect(resolveConfiguredAgentToolName("attempt_completion")).toBe(
			"submit_and_exit",
		);
		expect(resolveConfiguredAgentToolName("use_skill")).toBe("skills");
	});

	it("passes canonical and unknown names through unchanged (trimmed/lowered)", () => {
		expect(resolveConfiguredAgentToolName(" READ_FILES ")).toBe("read_files");
		expect(resolveConfiguredAgentToolName("some_future_tool")).toBe(
			"some_future_tool",
		);
	});
});

describe("filterToolsForConfiguredAgent (pipeline read-only enforcement)", () => {
	it("planner-like allowlist excludes ALL editing and shell tools", () => {
		const agent = makeAgent({
			name: "planner",
			tools: ["read_files", "search_codebase", "fetch_web_content", "submit_and_exit"],
		});
		const granted = filterToolsForConfiguredAgent(ALL_TOOLS, agent).map(
			(tool) => tool.name,
		);
		expect(granted).toEqual([
			"read_files",
			"search_codebase",
			"fetch_web_content",
			"submit_and_exit",
		]);
		// The hard requirement: no way to mutate the workspace.
		expect(granted).not.toContain("editor");
		expect(granted).not.toContain("apply_patch");
		expect(granted).not.toContain("run_commands");
	});

	it("reviewer-like allowlist excludes ALL editing and shell tools", () => {
		const agent = makeAgent({
			name: "reviewer",
			tools: ["read_files", "search_codebase", "submit_and_exit"],
		});
		const granted = filterToolsForConfiguredAgent(ALL_TOOLS, agent).map(
			(tool) => tool.name,
		);
		expect(granted).toEqual(["read_files", "search_codebase", "submit_and_exit"]);
		expect(granted).not.toContain("editor");
		expect(granted).not.toContain("apply_patch");
		expect(granted).not.toContain("run_commands");
	});

	it("generator/editor allowlists include editing tools", () => {
		const editing = [
			"read_files",
			"search_codebase",
			"run_commands",
			"apply_patch",
			"editor",
			"submit_and_exit",
		];
		const granted = filterToolsForConfiguredAgent(
			ALL_TOOLS,
			makeAgent({ name: "generator", tools: editing }),
		).map((tool) => tool.name);
		expect(granted).toContain("editor");
		expect(granted).toContain("apply_patch");
		expect(granted).toContain("run_commands");
		expect(granted).toHaveLength(editing.length);
	});

	it("legacy aliases in a read-only allowlist still cannot smuggle editing tools", () => {
		// A profile written with old-style names must map canonically —
		// "execute_command" grants run_commands but NEVER editor.
		const agent = makeAgent({
			name: "legacy-readonly",
			tools: ["read_file", "search_files", "execute_command", "attempt_completion"],
		});
		const granted = filterToolsForConfiguredAgent(ALL_TOOLS, agent).map(
			(tool) => tool.name,
		);
		expect(granted).toEqual([
			"read_files",
			"search_codebase",
			"run_commands",
			"submit_and_exit",
		]);
		expect(granted).not.toContain("editor");
		expect(granted).not.toContain("apply_patch");
	});

	it("returns the full tool set when no allowlist is declared", () => {
		const granted = filterToolsForConfiguredAgent(
			ALL_TOOLS,
			makeAgent({ name: "unrestricted" }),
		);
		expect(granted).toHaveLength(ALL_TOOLS.length);
	});

	it("skills declarations implicitly grant the skills tool", () => {
		const agent = makeAgent({
			name: "with-skills",
			tools: ["read_files"],
			skills: ["review-pr"],
		});
		const granted = filterToolsForConfiguredAgent(ALL_TOOLS, agent).map(
			(tool) => tool.name,
		);
		expect(granted).toContain("skills");
		expect(granted).not.toContain("editor");
	});
});
