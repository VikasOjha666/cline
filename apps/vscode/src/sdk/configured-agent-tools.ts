import { buildConfiguredAgentToolDescriptors, loadConfiguredAgentConfigs } from "@cline/core"
import { Logger } from "@shared/services/Logger"

/**
 * Exact `subagent_*` tool names the SDK will register for the configured-agent
 * profiles visible to this workspace (workspace `.cline/agents` + user
 * `~/.cline/agents`).
 *
 * Why this exists: the SDK treats tool policies as an allowlist of tools that
 * REQUIRE approval — "Tool names not listed here default to enabled +
 * autoApprove" (sdk/packages/shared/src/agents/types.ts). Without an explicit
 * entry, a `subagent_*` tool would execute with NO approval prompt, letting a
 * delegated agent edit files completely unattended. The returned names are
 * fed into `buildToolPolicies` with `autoApprove: false` so every delegation
 * requires the user's explicit approval.
 */
export function resolveConfiguredAgentToolNames(workspaceRoot?: string): string[] {
	try {
		const { configs } = loadConfiguredAgentConfigs({ workspaceRoot })
		return buildConfiguredAgentToolDescriptors(configs).map((descriptor) => descriptor.toolName)
	} catch (error) {
		Logger.warn("[ConfiguredAgents] Failed to resolve configured agent tool names:", error)
		return []
	}
}