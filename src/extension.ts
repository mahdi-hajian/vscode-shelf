import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ShelfProvider } from './shelfProvider';
import { ShelfItem, ShelfEntry } from './shelfItem';

const execAsync = promisify(exec);

let shelfProvider: ShelfProvider;

export function activate(context: vscode.ExtensionContext) {
    shelfProvider = new ShelfProvider(context);
    
    vscode.window.createTreeView('shelfView', {
        treeDataProvider: shelfProvider,
        showCollapseAll: true
    });

    // Register commands
    const shelveChangesCommand = vscode.commands.registerCommand('shelf.shelveChanges', async () => {
        await shelveChanges(context);
    });

    const shelveSelectedFilesCommand = vscode.commands.registerCommand('shelf.shelveSelectedFiles', async () => {
        await shelveSelectedFiles(context);
    });

    const unshelveCommand = vscode.commands.registerCommand('shelf.unshelve', async (item: ShelfItem) => {
        await unshelve(context, item);
    });

    const deleteCommand = vscode.commands.registerCommand('shelf.delete', async (item: ShelfItem) => {
        await deleteShelfItem(context, item);
    });

    const clearAllCommand = vscode.commands.registerCommand('shelf.clearAll', async () => {
        await clearAll(context);
    });

    const viewDiffCommand = vscode.commands.registerCommand('shelf.viewDiff', async (item: ShelfItem) => {
        await viewDiff(item);
    });

    const refreshCommand = vscode.commands.registerCommand('shelf.refresh', () => {
        shelfProvider.refresh();
    });

    context.subscriptions.push(
        shelveChangesCommand,
        shelveSelectedFilesCommand,
        unshelveCommand,
        deleteCommand,
        clearAllCommand,
        viewDiffCommand,
        refreshCommand
    );
}

export function deactivate() {}

async function getGitRepositoryPath(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        return null;
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git || !git.repositories || git.repositories.length === 0) {
        return null;
    }

    const repository = git.repositories[0];
    return repository.rootUri.fsPath;
}

interface GitFileStatus {
    path: string;
    status: string; // e.g., "M ", " D", "??", "A ", etc.
    isDeleted: boolean;
    isUntracked: boolean;
}

async function getChangedFilesFromGit(repoPath: string): Promise<GitFileStatus[]> {
    try {
        // Get all changed files (modified, added, deleted, untracked)
        const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
        const lines = stdout.trim().split('\n').filter(line => line.trim()).map(line => line.trim());
        
        const files: GitFileStatus[] = [];
        for (const line of lines) {
            // git status --porcelain format: XY filename
            // X = index status, Y = working tree status
            const status = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            
            // Include modified (M), added (A), deleted (D), renamed (R), copied (C), untracked (?)
            if (status[1] !== ' ' || status[0] !== ' ') {
                const isDeleted = status[0] === 'D' || status[1] === 'D';
                const isUntracked = status === '??';
                files.push({
                    path: filePath,
                    status: status,
                    isDeleted: isDeleted,
                    isUntracked: isUntracked
                });
            }
        }
        
        return files;
    } catch (error) {
        console.error('Error getting git status:', error);
        return [];
    }
}

async function shelveChanges(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const repoPath = await getGitRepositoryPath();
    if (!repoPath) {
        vscode.window.showErrorMessage('No git repository found. Please open a workspace with a git repository.');
        return;
    }

    // Get changed files using git status
    const changedFiles = await getChangedFilesFromGit(repoPath);
    if (changedFiles.length === 0) {
        vscode.window.showInformationMessage('No changes to shelve');
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for this shelf',
        placeHolder: 'e.g., WIP feature X'
    });

    if (!name) {
        return;
    }

    try {
        const shelfEntry = await createShelfEntryFromGitFiles(context, name, changedFiles, repoPath);
        shelfProvider.addShelfEntry(shelfEntry);
        vscode.window.showInformationMessage(`Changes shelved: ${name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to shelve changes: ${errorMessage}`);
        console.error('Shelve error:', error);
    }
}

async function shelveSelectedFiles(context: vscode.ExtensionContext) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        vscode.window.showErrorMessage('Git extension is required');
        return;
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
        vscode.window.showErrorMessage('Git API not available');
        return;
    }

    const repository = git.repositories[0];
    if (!repository) {
        vscode.window.showErrorMessage('No git repository found');
        return;
    }

    // Get git status first to have file paths
    const repoPath = repository.rootUri.fsPath;
    const gitStatusMap = new Map<string, string>();
    const gitFilePaths: string[] = [];
    
    try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        for (const line of lines) {
            const status = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            gitStatusMap.set(filePath, status);
            gitFilePaths.push(filePath);
        }
    } catch (error) {
        console.error('Error getting git status:', error);
    }

    // Get all changed files and filter those with resourceUri
    const allChanges = repository.state.workingTreeChanges.filter((change: vscode.SourceControlResourceState) => 
        change.resourceUri !== undefined
    );
    
    if (allChanges.length === 0 && gitFilePaths.length === 0) {
        vscode.window.showInformationMessage('No changes to shelve');
        return;
    }

    // Create a map of file paths to changes for quick lookup
    const changeMap = new Map<string, vscode.SourceControlResourceState>();
    for (const change of allChanges) {
        if (change.resourceUri) {
            const relativePath = path.relative(repoPath, change.resourceUri.fsPath).replace(/\\/g, '/');
            changeMap.set(relativePath, change);
        }
    }

    // Create quick pick items from changed files
    interface QuickPickItemWithChange extends vscode.QuickPickItem {
        change: vscode.SourceControlResourceState | null;
        filePath: string;
    }
    
    const quickPickItems: QuickPickItemWithChange[] = [];
    
    // Process files from git status
    for (const gitFilePath of gitFilePaths) {
        const normalizedGitPath = gitFilePath.replace(/\\/g, '/');
        const change = changeMap.get(normalizedGitPath);
        
        // If we have a change with resourceUri, use it
        if (change && change.resourceUri) {
            const filePath = change.resourceUri.fsPath;
            const fileName = path.basename(filePath);
            let relativePath = path.relative(repoPath, filePath).replace(/\\/g, '/');
            
            // Handle edge cases
            if (!relativePath || relativePath === '.' || relativePath === fileName) {
                relativePath = normalizedGitPath || fileName;
            }
            
            // Get status
            const gitStatus = gitStatusMap.get(gitFilePath);
            let statusText = 'Changed';
            if (gitStatus) {
                if (gitStatus[1] === 'M' || gitStatus[0] === 'M') {
                    statusText = 'Modified';
                } else if (gitStatus[1] === 'A' || gitStatus[0] === 'A') {
                    statusText = 'Added';
                } else if (gitStatus[1] === 'D' || gitStatus[0] === 'D') {
                    statusText = 'Deleted';
                } else if (gitStatus === '??') {
                    statusText = 'Untracked';
                } else if (gitStatus[1] === 'R' || gitStatus[0] === 'R') {
                    statusText = 'Renamed';
                }
            }
            
            quickPickItems.push({
                label: fileName,
                description: relativePath,
                detail: `${statusText} - ${relativePath}`,
                change: change,
                filePath: filePath,
                picked: false
            });
        } else {
            // Fallback: use git path directly
            const fileName = path.basename(normalizedGitPath);
            const gitStatus = gitStatusMap.get(gitFilePath);
            let statusText = 'Changed';
            if (gitStatus) {
                if (gitStatus[1] === 'M' || gitStatus[0] === 'M') {
                    statusText = 'Modified';
                } else if (gitStatus[1] === 'A' || gitStatus[0] === 'A') {
                    statusText = 'Added';
                } else if (gitStatus[1] === 'D' || gitStatus[0] === 'D') {
                    statusText = 'Deleted';
                } else if (gitStatus === '??') {
                    statusText = 'Untracked';
                } else if (gitStatus[1] === 'R' || gitStatus[0] === 'R') {
                    statusText = 'Renamed';
                }
            }
            
            const fullPath = path.isAbsolute(normalizedGitPath) ? normalizedGitPath : path.join(repoPath, normalizedGitPath);
            quickPickItems.push({
                label: fileName,
                description: normalizedGitPath,
                detail: `${statusText} - ${normalizedGitPath}`,
                change: null,
                filePath: fullPath,
                picked: false
            });
        }
    }

    if (quickPickItems.length === 0) {
        vscode.window.showInformationMessage('No changes to shelve');
        return;
    }

    // Show quick pick with multi-select
    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select files to shelve (use Space to select multiple)',
        canPickMany: true
    });

    if (!selectedItems || selectedItems.length === 0) {
        return;
    }

    // Separate items with change and without change
    const itemsWithChange = selectedItems.filter(item => item.change !== null);
    const itemsWithoutChange = selectedItems.filter(item => item.change === null);

    const name = await vscode.window.showInputBox({
        prompt: `Enter a name for this shelf (${selectedItems.length} file(s))`,
        placeHolder: 'e.g., WIP feature X'
    });

    if (!name) {
        return;
    }

    try {
        // If all items have change, use createShelfEntry
        if (itemsWithoutChange.length === 0 && itemsWithChange.length > 0) {
            const selectedChanges = itemsWithChange.map(item => item.change!);
            const shelfEntry = await createShelfEntry(context, name, selectedChanges, repository);
            shelfProvider.addShelfEntry(shelfEntry);
            vscode.window.showInformationMessage(`Changes shelved: ${name} (${selectedItems.length} file(s))`);
        } else {
            // Use git status approach for all files
            const selectedFileStatuses = selectedItems
                .filter(item => item.description) // Filter out items without description
                .map(item => {
                    const gitPath = item.description!;
                    const gitStatus = gitStatusMap.get(gitPath) || '  ';
                    const isDeleted = gitStatus[0] === 'D' || gitStatus[1] === 'D';
                    const isUntracked = gitStatus === '??';
                    return {
                        path: gitPath,
                        status: gitStatus,
                        isDeleted: isDeleted,
                        isUntracked: isUntracked
                    };
                });
            
            if (selectedFileStatuses.length === 0) {
                vscode.window.showErrorMessage('No valid files selected');
                return;
            }
            
            const shelfEntry = await createShelfEntryFromGitFiles(context, name, selectedFileStatuses, repoPath);
            shelfProvider.addShelfEntry(shelfEntry);
            vscode.window.showInformationMessage(`Changes shelved: ${name} (${selectedFileStatuses.length} file(s))`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to shelve changes: ${errorMessage}`);
        console.error('Shelve error:', error);
    }
}

async function createShelfEntryFromGitFiles(
    context: vscode.ExtensionContext,
    name: string,
    fileStatuses: GitFileStatus[],
    repoPath: string
): Promise<ShelfEntry> {
    const shelfDir = path.join(context.globalStoragePath, 'shelf');
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
                continue;
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

async function createShelfEntry(
    context: vscode.ExtensionContext,
    name: string,
    changes: vscode.SourceControlResourceState[],
    repository?: any
): Promise<ShelfEntry> {
    const shelfDir = path.join(context.globalStoragePath, 'shelf');
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
            const fileUri = change.resourceUri;
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
                continue;
            }

            // Ensure relativePath is not empty
            if (!relativePath || relativePath.trim() === '') {
                console.warn(`Skipping file with empty relative path: ${fileUri.fsPath}`);
                continue;
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
                continue;
            }

            // Write the content to shelf
            fs.writeFileSync(filePath, content);
            files[relativePath] = fileUri.fsPath;
            console.log(`Successfully shelved: ${relativePath}`);
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

async function unshelve(context: vscode.ExtensionContext, item: ShelfItem) {
    const entry = item.entry;
    const entryDir = path.join(context.globalStoragePath, 'shelf', entry.id);

    if (!fs.existsSync(entryDir)) {
        vscode.window.showErrorMessage('Shelf entry not found');
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders![0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;

    let restoredCount = 0;
    let errorCount = 0;

    // If filePath is set, only unshelve that specific file
    const filesToRestore = item.filePath 
        ? { [item.filePath]: entry.files[item.filePath] }
        : entry.files;

    for (const [relativePath, originalPath] of Object.entries(filesToRestore)) {
        try {
            const shelfFilePath = path.join(entryDir, relativePath);
            if (fs.existsSync(shelfFilePath)) {
                const content = fs.readFileSync(shelfFilePath);
                const targetPath = path.join(workspacePath, relativePath);
                
                // Ensure directory exists
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                fs.writeFileSync(targetPath, content);
                restoredCount++;
            }
        } catch (error) {
            errorCount++;
            console.error(`Failed to restore ${relativePath}:`, error);
        }
    }

    if (restoredCount > 0) {
        vscode.window.showInformationMessage(
            `Unshelved ${restoredCount} file(s)${errorCount > 0 ? ` (${errorCount} error(s))` : ''}`
        );
        // Git repository state will automatically refresh when files change
        // No need to manually call load() as it doesn't exist in the API
    } else {
        vscode.window.showErrorMessage('Failed to unshelve files');
    }
}

async function deleteShelfItem(context: vscode.ExtensionContext, item: ShelfItem) {
    const entry = item.entry;
    const confirmed = await vscode.window.showWarningMessage(
        `Delete shelf "${entry.name}"?`,
        { modal: true },
        'Delete'
    );

    if (confirmed === 'Delete') {
        const entryDir = path.join(context.globalStoragePath, 'shelf', entry.id);
        if (fs.existsSync(entryDir)) {
            fs.rmSync(entryDir, { recursive: true, force: true });
            shelfProvider.removeShelfEntry(entry.id);
            vscode.window.showInformationMessage(`Shelf "${entry.name}" deleted`);
        }
    }
}

async function clearAll(context: vscode.ExtensionContext) {
    const confirmed = await vscode.window.showWarningMessage(
        'Clear all shelves?',
        { modal: true },
        'Clear All'
    );

    if (confirmed === 'Clear All') {
        const shelfDir = path.join(context.globalStoragePath, 'shelf');
        if (fs.existsSync(shelfDir)) {
            fs.rmSync(shelfDir, { recursive: true, force: true });
            fs.mkdirSync(shelfDir, { recursive: true });
            shelfProvider.clearAll();
            vscode.window.showInformationMessage('All shelves cleared');
        }
    }
}

async function viewDiff(item: ShelfItem) {
    const entry = item.entry;
    const context = shelfProvider.getContext();
    const entryDir = path.join(context.globalStoragePath, 'shelf', entry.id);
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }
    const workspacePath = workspaceFolder.uri.fsPath;

    let filePath = item.filePath;
    
    // If no file selected (clicked on shelf entry), let user choose
    if (!filePath) {
        const fileKeys = Object.keys(entry.files);
        if (fileKeys.length === 0) {
            vscode.window.showErrorMessage('No files in this shelf');
            return;
        }
        
        if (fileKeys.length === 1) {
            // Only one file, use it automatically
            filePath = fileKeys[0];
        } else {
            // Multiple files, let user choose
            const selected = await vscode.window.showQuickPick(
                fileKeys.map(f => ({ label: path.basename(f), description: f, value: f })),
                { placeHolder: 'Select a file to view diff' }
            );
            
            if (!selected) {
                return;
            }
            filePath = selected.value;
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
        const currentUri = vscode.Uri.file(currentFilePath);
        await vscode.commands.executeCommand(
            'vscode.diff',
            currentUri,
            shelfUri,
            `${path.basename(relativePath)} (Current ↔ Shelf: ${entry.name})`
        );
    } else {
        // File doesn't exist (deleted) - show diff with empty file
        // Create a temporary empty file for comparison
        const tempDir = path.join(context.globalStoragePath, 'shelf', 'temp');
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
            `${path.basename(relativePath)} (Deleted ↔ Shelf: ${entry.name})`
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
}

