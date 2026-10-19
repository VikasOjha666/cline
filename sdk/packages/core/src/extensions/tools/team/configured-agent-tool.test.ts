import { describe, expect, it } from "vitest";
import {
	buildConfiguredAgentToolDescriptors,
	buildConfiguredAgentToolName,
	createConfiguredAgentTools,
} from "./configured-agent-tool";

describe("configured agent tools", () => {
	it("builds stable subagent tool names", () => {
		expect(buildConfiguredAgentToolName("Code Reviewer")).toBe(
			"subagent_code_reviewer",
		);
		expect(buildConfiguredAgentToolName("___")).toBe("subagent_agent");
	});

	it("de-duplicates colliding tool names with numeric suffixes", () => {
		// Two distinct profile names that sanitize to the same base must not
		// silently shadow each other: the descriptor builder appends _2, _3...
		const descriptors = buildConfiguredAgentToolDescriptors([
			{ name: "Planner!", description: "a", systemPrompt: "a" },
			{ name: "planner", description: "b", systemPrompt: "b" },
			{ name: "planner__", description: "c", systemPrompt: "c" },
		]);
		const names = descriptors.map((d) => d.toolName);
		expect(new Set(names).size).toBe(names.length);
		expect(names.every((n) => n.startsWith("subagent_planner"))).toBe(true);
	});

	it("caps overlong tool names at 64 chars with a stable hash suffix", () => {
		const longName = `agent-${"x".repeat(120)}`;
		const toolName = buildConfiguredAgentToolName(longName);
		expect(toolName.length).toBeLessThanOrEqual(64);
		// Sanitization maps "-" to "_", so the body prefix is agent_.
		expect(toolName.startsWith("subagent_agent_")).toBe(true);
		// Stable across calls (the model must be able to invoke it repeatedly).
		expect(buildConfiguredAgentToolName(longName)).toBe(toolName);
	});

	it("matches spawn_agent timeout and retry policy", () => {
		const [tool] = createConfiguredAgentTools({
			configProvider: {
				getRuntimeConfig: () => ({
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: "key",
				}),
				getConnectionConfig: () => ({
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: "key",
				}),
				updateConnectionDefaults: () => {},
			},
			agents: [
				{
					name: "code-reviewer",
					description: "Reviews code",
					systemPrompt: "You are a code reviewer.",
				},
			],
		});

		expect(tool?.name).toBe("subagent_code_reviewer");
		expect(tool?.executionMode).toBe("parallel");
		expect(tool?.timeoutMs).toBe(300000);
		expect(tool?.retryable).toBe(false);
	});
});
