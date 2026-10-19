import { EmptyRequest, String } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { ExtensionRegistryInfo } from "@/registry"

export async function getIdeRedirectUri(_: EmptyRequest): Promise<String> {
	if (vscode.env.uiKind === vscode.UIKind.Web) {
		// In VS Code Web (code serve-web), the auth callback is handled by an HTTP server
		// (AuthHandler). Returning empty here means the success page won't try to redirect
		// to a vscode:// URI (which would open the desktop app instead of the web tab).
		return { value: "" }
	}
	const uriScheme = vscode.env.uriScheme || "vscode"
	// Derive from the live extension identity (publisher.name) so the fork's
	// OAuth callbacks route to this extension, not upstream Cline's ID.
	return { value: `${uriScheme}://${ExtensionRegistryInfo.id}` }
}
