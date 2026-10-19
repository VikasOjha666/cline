import type { EmptyRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"
import { telemetryService } from "@/services/telemetry"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Opens the Cline walkthrough in VSCode
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function openWalkthrough(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await vscode.commands.executeCommand(
			// Use the registry's publisher (not a hardcoded upstream value) so the
			// walkthrough resolves for this extension's actual ID in the fork.
			`workbench.action.openWalkthrough`,
			`${ExtensionRegistryInfo.publisher}.${ExtensionRegistryInfo.name}#ClineWalkthrough`,
		)
		telemetryService.captureButtonClick("webview_openWalkthrough")
		return Empty.create({})
	} catch (error) {
		Logger.error(`Failed to open walkthrough: ${error}`)
		throw error
	}
}
