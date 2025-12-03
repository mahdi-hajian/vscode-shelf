import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShelfItem } from './shelfItem';
import { ShelfProvider } from './shelfProvider';
import { getShelfDirectory } from './shelfUtils';

let shelfProvider: ShelfProvider;

export function setShelfProvider(provider: ShelfProvider): void {
    shelfProvider = provider;
}

/**
 * Views the diff between current file and shelf version
 */
export async function viewDiff(item: ShelfItem): Promise<void> {
    const entry = item.entry;
    const context = shelfProvider.getContext();
    const shelfDir = getShelfDirectory(context);
    const entryDir = path.join(shelfDir, entry.id);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }
    const workspacePath = workspaceFolder.uri.fsPath;

    let filePath = item.filePath;
    
    // If no file selected (clicked on shelf entry), let user choose
    if (!filePath) {
        filePath = await selectFileForDiff(entry);
        if (!filePath) {
            return;
        }
    }

    const relativePath = filePath;
    const shelfFilePath = path.join(entryDir, relativePath);

    if (!fs.existsSync(shelfFilePath)) {
        vscode.window.showErrorMessage('Shelf file not found');
        return;
    }

    const shelfUri = vscode.Uri.file(shelfFilePath);
    const currentFilePath = path.join(workspacePath, relativePath);
    const fileExists = fs.existsSync(currentFilePath);

    if (fileExists) {
        // File exists - show diff: current (left) vs shelf (right)
        await showFileDiff(currentFilePath, shelfUri, relativePath, entry.name, false);
    } else {
        // File doesn't exist (deleted) - show diff with empty file
        await showDeletedFileDiff(shelfUri, relativePath, entry.name, context);
    }
}

/**
 * Selects a file for diff when multiple files exist
 */
async function selectFileForDiff(entry: any): Promise<string | undefined> {
    const fileKeys = Object.keys(entry.files);
    if (fileKeys.length === 0) {
        vscode.window.showErrorMessage('No files in this shelf');
        return undefined;
    }
    
    if (fileKeys.length === 1) {
        // Only one file, use it automatically
        return fileKeys[0];
    } else {
        // Multiple files, let user choose
        const selected = await vscode.window.showQuickPick(
            fileKeys.map(f => ({ label: path.basename(f), description: f, value: f })),
            { placeHolder: 'Select a file to view diff' }
        );
        
        return selected?.value;
    }
}

/**
 * Shows diff for existing file
 */
async function showFileDiff(
    currentFilePath: string,
    shelfUri: vscode.Uri,
    relativePath: string,
    entryName: string,
    isDeleted: boolean
): Promise<void> {
    const currentUri = vscode.Uri.file(currentFilePath);
    const title = isDeleted
        ? `${path.basename(relativePath)} (Deleted ↔ Shelf: ${entryName})`
        : `${path.basename(relativePath)} (Current ↔ Shelf: ${entryName})`;
    
    await vscode.commands.executeCommand('vscode.diff', currentUri, shelfUri, title);
}

/**
 * Shows diff for deleted file (compares empty file with shelf)
 */
async function showDeletedFileDiff(
    shelfUri: vscode.Uri,
    relativePath: string,
    entryName: string,
    context: vscode.ExtensionContext
): Promise<void> {
    // Create a temporary empty file for comparison
    const shelfDir = getShelfDirectory(context);
    const tempDir = path.join(shelfDir, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFilePath = path.join(tempDir, path.basename(relativePath));
    
    // Create empty file
    fs.writeFileSync(tempFilePath, '');
    const tempUri = vscode.Uri.file(tempFilePath);

    // Show diff: empty (left) vs shelf (right)
    await vscode.commands.executeCommand(
        'vscode.diff',
        tempUri,
        shelfUri,
        `${path.basename(relativePath)} (Deleted ↔ Shelf: ${entryName})`
    );

    // Clean up temp file after a delay
    setTimeout(() => {
        try {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }, 1000);
}

