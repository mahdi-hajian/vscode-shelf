import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Gets the workspace-specific shelf directory path
 * Uses globalStoragePath with workspace identifier hash to create per-project shelf storage
 */
export function getShelfDirectory(context: vscode.ExtensionContext): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        // Create a hash of the workspace URI to create a unique identifier per project
        const workspaceUri = workspaceFolder.uri.toString();
        const workspaceHash = crypto.createHash('md5').update(workspaceUri).digest('hex').substring(0, 8);
        return path.join(context.globalStoragePath, 'shelf', workspaceHash);
    }
    
    // Fallback: use globalStoragePath (shouldn't happen in normal usage)
    return path.join(context.globalStoragePath, 'shelf');
}

