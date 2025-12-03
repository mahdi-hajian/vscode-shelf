import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ShelfEntry } from './shelfItem';
import { GitFileStatus } from './gitUtils';
import { getShelfDirectory } from './shelfUtils';

const execAsync = promisify(exec);

/**
 * Creates a shelf entry from git file statuses
 */
export async function createShelfEntryFromGitFiles(
    context: vscode.ExtensionContext,
    name: string,
    fileStatuses: GitFileStatus[],
    repoPath: string
): Promise<ShelfEntry> {
    const shelfDir = getShelfDirectory(context);
    if (!fs.existsSync(shelfDir)) {
        fs.mkdirSync(shelfDir, { recursive: true });
    }

    const timestamp = Date.now();
    const entryId = `${timestamp}-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const entryDir = path.join(shelfDir, entryId);
    fs.mkdirSync(entryDir, { recursive: true });

    const files: { [key: string]: string } = {};
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const workspacePath = workspaceFolder.uri.fsPath;
    
    console.log(`Creating shelf entry for ${fileStatuses.length} file(s) in workspace: ${workspacePath}`);

    for (const fileStatus of fileStatuses) {
        try {
            await shelveFile(fileStatus, repoPath, workspacePath, entryDir, files);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`Failed to shelve file ${fileStatus.path}: ${errorMsg}`);
            // Continue with other files
        }
    }

    if (Object.keys(files).length === 0) {
        const errorDetails = fileStatuses.length > 0 
            ? `Attempted to shelve ${fileStatuses.length} file(s) but all failed. Check the console for details.`
            : 'No changes were found to shelve.';
        throw new Error(`No files were successfully shelved. ${errorDetails}`);
    }

    const entry: ShelfEntry = {
        id: entryId,
        name: name,
        timestamp: timestamp,
        files: files,
        workspacePath: workspacePath
    };

    const entryFile = path.join(entryDir, 'entry.json');
    fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2));

    return entry;
}

/**
 * Creates a shelf entry from VSCode source control changes
 */
export async function createShelfEntry(
    context: vscode.ExtensionContext,
    name: string,
    changes: vscode.SourceControlResourceState[],
    repository?: any
): Promise<ShelfEntry> {
    const shelfDir = getShelfDirectory(context);
    if (!fs.existsSync(shelfDir)) {
        fs.mkdirSync(shelfDir, { recursive: true });
    }

    const timestamp = Date.now();
    const entryId = `${timestamp}-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const entryDir = path.join(shelfDir, entryId);
    fs.mkdirSync(entryDir, { recursive: true });

    const files: { [key: string]: string } = {};
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }
    const workspacePath = workspaceFolder.uri.fsPath;
    
    console.log(`Creating shelf entry for ${changes.length} change(s) in workspace: ${workspacePath}`);

    for (const change of changes) {
        if (!change.resourceUri) {
            console.warn('Skipping change with undefined resourceUri');
            continue;
        }

        try {
            await shelveChange(change, workspacePath, entryDir, files);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`Failed to shelve file ${change.resourceUri?.fsPath}: ${errorMsg}`);
            // Continue with other files
        }
    }

    if (Object.keys(files).length === 0) {
        const errorDetails = changes.length > 0 
            ? `Attempted to shelve ${changes.length} file(s) but all failed. Check the console for details.`
            : 'No changes were found to shelve.';
        throw new Error(`No files were successfully shelved. ${errorDetails}`);
    }

    const entry: ShelfEntry = {
        id: entryId,
        name: name,
        timestamp: timestamp,
        files: files,
        workspacePath: workspacePath
    };

    const entryFile = path.join(entryDir, 'entry.json');
    fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2));

    return entry;
}

/**
 * Shelves a single file from git status
 */
async function shelveFile(
    fileStatus: GitFileStatus,
    repoPath: string,
    workspacePath: string,
    entryDir: string,
    files: { [key: string]: string }
): Promise<void> {
    const filePath = fileStatus.path;
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath);
    const fileUri = vscode.Uri.file(fullPath);
    
    // Get relative path from workspace
    let relativePath = path.relative(workspacePath, fullPath);
    
    // Normalize path separators
    relativePath = relativePath.replace(/\\/g, '/');
    
    // Skip if outside workspace
    if (relativePath.startsWith('..')) {
        console.warn(`Skipping file outside workspace: ${fullPath}`);
        return;
    }

    // Ensure relativePath is not empty
    if (!relativePath || relativePath.trim() === '') {
        relativePath = path.basename(fullPath);
    }

    const fileDir = path.join(entryDir, path.dirname(relativePath));
    if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
    }
    
    const shelfFilePath = path.join(entryDir, relativePath);
    let content: Uint8Array;

    // Check if file exists in filesystem
    if (fs.existsSync(fullPath)) {
        // File exists - read current content from filesystem
        try {
            content = await vscode.workspace.fs.readFile(fileUri);
        } catch (readError) {
            // Fallback to fs.readFileSync
            content = fs.readFileSync(fullPath);
        }
    } else if (fileStatus.isDeleted) {
        // File is deleted - try to read from git HEAD
        try {
            const { stdout } = await execAsync(`git show HEAD:${filePath}`, { cwd: repoPath });
            content = Buffer.from(stdout, 'utf8');
        } catch (gitError) {
            // If git show fails, save as empty
            content = new Uint8Array(0);
            console.warn(`Could not read deleted file ${fullPath} from git, saving as empty`);
        }
    } else {
        // File doesn't exist and is not deleted (untracked that was removed?)
        content = new Uint8Array(0);
        console.warn(`File ${fullPath} not found, saving as empty`);
    }

    // Write the content to shelf
    fs.writeFileSync(shelfFilePath, content);
    files[relativePath] = fullPath;
    console.log(`Successfully shelved: ${relativePath} (${fileStatus.status})`);
}

/**
 * Shelves a single change from VSCode source control
 */
async function shelveChange(
    change: vscode.SourceControlResourceState,
    workspacePath: string,
    entryDir: string,
    files: { [key: string]: string }
): Promise<void> {
    const fileUri = change.resourceUri!;
    let relativePath = path.relative(workspacePath, fileUri.fsPath);
    
    // Handle root-level files (relativePath might be empty or just filename)
    if (!relativePath || relativePath === '.' || relativePath === path.basename(fileUri.fsPath)) {
        relativePath = path.basename(fileUri.fsPath);
    }
    
    // Normalize path separators for cross-platform compatibility
    relativePath = relativePath.replace(/\\/g, '/');
    
    // Skip if relative path is invalid (outside workspace)
    if (relativePath.startsWith('..')) {
        console.warn(`Skipping file outside workspace: ${fileUri.fsPath}`);
        return;
    }

    // Ensure relativePath is not empty
    if (!relativePath || relativePath.trim() === '') {
        console.warn(`Skipping file with empty relative path: ${fileUri.fsPath}`);
        return;
    }

    const fileDir = path.join(entryDir, path.dirname(relativePath));
    if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
    }
    
    const filePath = path.join(entryDir, relativePath);
    let content: Uint8Array;

    // Try to read file content
    try {
        // First, try to read from filesystem (works for existing files)
        if (fs.existsSync(fileUri.fsPath)) {
            content = await vscode.workspace.fs.readFile(fileUri);
        } else {
            // File doesn't exist in filesystem - might be deleted or untracked
            // Try to read using workspace.fs API (might work for some cases)
            try {
                content = await vscode.workspace.fs.readFile(fileUri);
            } catch {
                // If that fails, check if it's a deleted file and try to get from Git
                // For now, we'll create an empty file marker
                content = new Uint8Array(0);
                console.warn(`File ${fileUri.fsPath} not found, saving as empty`);
            }
        }
    } catch (readError) {
        const errorMsg = readError instanceof Error ? readError.message : String(readError);
        console.error(`Error reading file ${fileUri.fsPath}: ${errorMsg}`);
        // Skip this file
        return;
    }

    // Write the content to shelf
    fs.writeFileSync(filePath, content);
    files[relativePath] = fileUri.fsPath;
    console.log(`Successfully shelved: ${relativePath}`);
}

