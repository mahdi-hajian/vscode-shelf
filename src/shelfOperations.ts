import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { diffLines } from 'diff';
import { ShelfItem, ShelfEntry } from './shelfItem';
import { ShelfProvider } from './shelfProvider';
import { 
    getGitRepositoryPath, 
    getChangedFilesFromGit, 
    getGitStatusMap, 
    getStatusText,
    getGitRepository,
    getCurrentBranch,
    GitFileStatus 
} from './gitUtils';
import { createShelfEntryFromGitFiles, createShelfEntry } from './shelfStorage';
import { getShelfDirectory } from './shelfUtils';

let shelfProvider: ShelfProvider;

export function setShelfProvider(provider: ShelfProvider): void {
    shelfProvider = provider;
}

/**
 * Shelves all changes in the repository
 */
export async function shelveChanges(context: vscode.ExtensionContext): Promise<void> {
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

/**
 * Shelves selected files from the repository
 */
export async function shelveSelectedFiles(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder found');
        return;
    }

    const gitRepo = getGitRepository();
    if (!gitRepo) {
        vscode.window.showErrorMessage('Git extension is required');
        return;
    }

    const { repository } = gitRepo;
    const repoPath = repository.rootUri.fsPath;
    const gitStatusMap = await getGitStatusMap(repoPath);
    const gitFilePaths: string[] = Array.from(gitStatusMap.keys());

    // Get all changed files and filter those with resourceUri
    const allChanges = repository.state.workingTreeChanges.filter((change: vscode.SourceControlResourceState) => 
        change.resourceUri !== undefined
    );
    
    if (allChanges.length === 0 && gitFilePaths.length === 0) {
        vscode.window.showInformationMessage('No changes to shelve');
        return;
    }

    // Create quick pick items
    const quickPickItems = createQuickPickItems(allChanges, gitFilePaths, gitStatusMap, repoPath);

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

    // Get shelf name
    const name = await vscode.window.showInputBox({
        prompt: `Enter a name for this shelf (${selectedItems.length} file(s))`,
        placeHolder: 'e.g., WIP feature X'
    });

    if (!name) {
        return;
    }

    try {
        await processSelectedFiles(context, selectedItems, name, gitStatusMap, repoPath, repository);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to shelve changes: ${errorMessage}`);
        console.error('Shelve error:', error);
    }
}

/**
 * Creates quick pick items for file selection
 */
interface QuickPickItemWithChange extends vscode.QuickPickItem {
    change: vscode.SourceControlResourceState | null;
    filePath: string;
}

function createQuickPickItems(
    allChanges: vscode.SourceControlResourceState[],
    gitFilePaths: string[],
    gitStatusMap: Map<string, string>,
    repoPath: string
): QuickPickItemWithChange[] {
    // Create a map of file paths to changes for quick lookup
    const changeMap = new Map<string, vscode.SourceControlResourceState>();
    for (const change of allChanges) {
        if (change.resourceUri) {
            const relativePath = path.relative(repoPath, change.resourceUri.fsPath).replace(/\\/g, '/');
            changeMap.set(relativePath, change);
        }
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
            const statusText = getStatusText(gitStatus);
            
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
            const statusText = getStatusText(gitStatus);
            
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

    return quickPickItems;
}

/**
 * Processes selected files and creates shelf entry
 */
async function processSelectedFiles(
    context: vscode.ExtensionContext,
    selectedItems: QuickPickItemWithChange[],
    name: string,
    gitStatusMap: Map<string, string>,
    repoPath: string,
    repository: any
): Promise<void> {
    // Separate items with change and without change
    const itemsWithChange = selectedItems.filter(item => item.change !== null);
    const itemsWithoutChange = selectedItems.filter(item => item.change === null);

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
                } as GitFileStatus;
            });
        
        if (selectedFileStatuses.length === 0) {
            vscode.window.showErrorMessage('No valid files selected');
            return;
        }
        
        const shelfEntry = await createShelfEntryFromGitFiles(context, name, selectedFileStatuses, repoPath);
        shelfProvider.addShelfEntry(shelfEntry);
        vscode.window.showInformationMessage(`Changes shelved: ${name} (${selectedFileStatuses.length} file(s))`);
    }
}

/**
 * Result summary for unshelve operations
 */
interface UnshelveSummary {
    restored: number;
    skipped: number;
    identical: number;
    errors: number;
    conflicts: number;
    conflictMarkers: number;
}

type RestoreStatus = 'restored' | 'identical' | 'skipped' | 'conflictMarked';

interface RestoreFileResult {
    status: RestoreStatus;
    conflict: boolean;
}

type ConflictResolutionChoice = 'apply' | 'skip' | 'mark';

/**
 * Restores a list of shelved files while surfacing diffs instead of overriding blindly.
 */
async function restoreFilesFromShelf(
    entry: ShelfEntry,
    relativePaths: string[],
    workspacePath: string,
    entryDir: string
): Promise<UnshelveSummary> {
    const summary: UnshelveSummary = {
        restored: 0,
        skipped: 0,
        identical: 0,
        errors: 0,
        conflicts: 0,
        conflictMarkers: 0
    };

    for (const relativePath of relativePaths) {
        try {
            const result = await restoreSingleFile(entry, relativePath, workspacePath, entryDir);
            if (result.conflict) {
                summary.conflicts++;
            }
            switch (result.status) {
                case 'restored':
                    summary.restored++;
                    break;
                case 'identical':
                    summary.identical++;
                    break;
                case 'skipped':
                    summary.skipped++;
                    break;
                case 'conflictMarked':
                    summary.conflictMarkers++;
                    break;
            }
        } catch (error) {
            summary.errors++;
            console.error(`Failed to restore ${relativePath}:`, error);
        }
    }

    return summary;
}

/**
 * Restores a single shelved file, showing a diff when a conflict is detected.
 */
async function restoreSingleFile(
    entry: ShelfEntry,
    relativePath: string,
    workspacePath: string,
    entryDir: string
): Promise<RestoreFileResult> {
    const shelfFilePath = path.join(entryDir, relativePath);
    if (!fs.existsSync(shelfFilePath)) {
        throw new Error(`Shelf file not found: ${relativePath}`);
    }

    const targetPath = path.join(workspacePath, relativePath);
    const shelfContent = fs.readFileSync(shelfFilePath);

    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, shelfContent);
        return { status: 'restored', conflict: false };
    }

    const targetContent = fs.readFileSync(targetPath);
    if (Buffer.compare(shelfContent, targetContent) === 0) {
        return { status: 'identical', conflict: false };
    }

    const resolution = await showDiffForConflict(entry, relativePath, targetPath, shelfFilePath);
    if (resolution === 'apply') {
        fs.writeFileSync(targetPath, shelfContent);
        return { status: 'restored', conflict: true };
    }

    if (resolution === 'mark') {
        insertConflictMarkers(targetPath, entry.name, targetContent, shelfContent);
        return { status: 'conflictMarked', conflict: true };
    }

    return { status: 'skipped', conflict: true };
}

/**
 * Opens a diff for conflicting files and asks the user whether to apply the shelved version.
 */
async function showDiffForConflict(
    entry: ShelfEntry,
    relativePath: string,
    targetPath: string,
    shelfFilePath: string
): Promise<ConflictResolutionChoice> {
    const diffTitle = `${path.basename(relativePath)} (Current ↔ Shelf: ${entry.name})`;
    try {
        await vscode.commands.executeCommand(
            'vscode.diff',
            vscode.Uri.file(targetPath),
            vscode.Uri.file(shelfFilePath),
            diffTitle
        );
    } catch (error) {
        console.error(`Failed to open diff for ${relativePath}:`, error);
    }

    const choice = await vscode.window.showWarningMessage(
        `File "${relativePath}" already contains changes. Choose how to proceed:`,
        { modal: true },
        'Apply Shelf Version',
        'Keep Current',
        'Mark As Conflict'
    );

    switch (choice) {
        case 'Apply Shelf Version':
            return 'apply';
        case 'Mark As Conflict':
            return 'mark';
        default:
            return 'skip';
    }
}

/**
 * Writes git-style conflict markers to the target file.
 */
function insertConflictMarkers(
    targetPath: string,
    entryName: string,
    currentContent: Buffer,
    shelfContent: Buffer
): void {
    const currentText = currentContent.toString('utf8');
    const shelfText = shelfContent.toString('utf8');
    const lineEnding = detectLineEnding(currentText, shelfText) ?? os.EOL;

    const diffs = diffLines(currentText, shelfText);
    const builder: string[] = [];
    let pendingRemoved = '';

    const flushPending = (addedValue: string): void => {
        builder.push(`<<<<<<< Current Workspace${lineEnding}`);
        if (pendingRemoved) {
            builder.push(pendingRemoved);
            if (!pendingRemoved.endsWith('\n') && !pendingRemoved.endsWith('\r')) {
                builder.push(lineEnding);
            }
        }
        builder.push(`=======${lineEnding}`);
        if (addedValue) {
            builder.push(addedValue);
            if (!addedValue.endsWith('\n') && !addedValue.endsWith('\r')) {
                builder.push(lineEnding);
            }
        }
        builder.push(`>>>>>>> Shelf: ${entryName}${lineEnding}`);
        pendingRemoved = '';
    };

    for (const part of diffs) {
        if (part.removed) {
            pendingRemoved += part.value;
            continue;
        }

        if (part.added) {
            flushPending(part.value);
            continue;
        }

        if (pendingRemoved) {
            flushPending('');
        }

        builder.push(part.value);
    }

    if (pendingRemoved) {
        flushPending('');
    }

    fs.writeFileSync(targetPath, builder.join(''), 'utf8');
}

function detectLineEnding(...texts: string[]): string | undefined {
    for (const text of texts) {
        const match = text.match(/\r\n|\n|\r/);
        if (match) {
            return match[0];
        }
    }
    return undefined;
}

/**
 * Shows a consistent summary after restoring files from the shelf.
 */
function reportUnshelveSummary(summary: UnshelveSummary): void {
    const parts: string[] = [];
    if (summary.restored > 0) {
        parts.push(`${summary.restored} applied`);
    }
    if (summary.identical > 0) {
        parts.push(`${summary.identical} already up-to-date`);
    }
    if (summary.conflicts > 0) {
        const label = summary.conflicts === 1 ? 'diff opened' : 'diffs opened';
        parts.push(`${summary.conflicts} ${label}`);
    }
    if (summary.conflictMarkers > 0) {
        const label = summary.conflictMarkers === 1 ? 'conflict marked' : 'conflicts marked';
        parts.push(`${summary.conflictMarkers} ${label}`);
    }
    if (summary.skipped > 0) {
        parts.push(`${summary.skipped} skipped`);
    }
    if (summary.errors > 0) {
        parts.push(`${summary.errors} error${summary.errors > 1 ? 's' : ''}`);
    }

    const message = parts.length > 0
        ? `Unshelve result: ${parts.join(', ')}`
        : 'Unshelve result: No files were processed.';

    if (summary.errors > 0) {
        vscode.window.showErrorMessage(message);
    } else if (summary.restored > 0) {
        vscode.window.showInformationMessage(message);
    } else {
        vscode.window.showWarningMessage(message);
    }
}

/**
 * Unshelves all files from a shelf entry
 */
export async function unshelveAll(context: vscode.ExtensionContext, item: ShelfItem): Promise<void> {
    const entry = item.entry;
    const shelfDir = getShelfDirectory(context);
    const entryDir = path.join(shelfDir, entry.id);

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

    const relativePaths = (item.filePath ? [item.filePath] : Object.keys(entry.files)).filter(Boolean);
    if (relativePaths.length === 0) {
        vscode.window.showWarningMessage('No files found in this shelf entry.');
        return;
    }

    const summary = await restoreFilesFromShelf(entry, relativePaths, workspacePath, entryDir);
    reportUnshelveSummary(summary);
}

/**
 * Unshelves selected files from a shelf entry
 */
export async function unshelveSelection(context: vscode.ExtensionContext, item: ShelfItem): Promise<void> {
    const entry = item.entry;
    
    // Only allow selection for shelf entries (not individual files)
    if (item.filePath) {
        vscode.window.showErrorMessage('This command can only be used on shelf entries, not individual files');
        return;
    }

    const filePaths = Object.keys(entry.files);
    if (filePaths.length === 0) {
        vscode.window.showInformationMessage('No files in this shelf entry');
        return;
    }

    // Create quick pick items for file selection
    const quickPickItems: vscode.QuickPickItem[] = filePaths.map(relativePath => ({
        label: path.basename(relativePath),
        description: relativePath,
        detail: `File: ${relativePath}`,
        picked: false
    }));

    // Show quick pick with multi-select
    const selectedItems = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select files to unshelve (use Space to select multiple)',
        canPickMany: true
    });

    if (!selectedItems || selectedItems.length === 0) {
        return;
    }

    // Get selected file paths
    const selectedPaths = selectedItems.map(item => item.description!);

    const shelfDir = getShelfDirectory(context);
    const entryDir = path.join(shelfDir, entry.id);
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

    const summary = await restoreFilesFromShelf(entry, selectedPaths, workspacePath, entryDir);
    reportUnshelveSummary(summary);
}

/**
 * Deletes a shelf item
 */
export async function deleteShelfItem(context: vscode.ExtensionContext, item: ShelfItem): Promise<void> {
    const entry = item.entry;
    const confirmed = await vscode.window.showWarningMessage(
        `Delete shelf "${entry.name}"?`,
        { modal: true },
        'Delete'
    );

    if (confirmed === 'Delete') {
        const shelfDir = getShelfDirectory(context);
        const entryDir = path.join(shelfDir, entry.id);
        if (fs.existsSync(entryDir)) {
            fs.rmSync(entryDir, { recursive: true, force: true });
            shelfProvider.removeShelfEntry(entry.id);
            vscode.window.showInformationMessage(`Shelf "${entry.name}" deleted`);
        }
    }
}

/**
 * Clears all shelves
 */
export async function clearAll(context: vscode.ExtensionContext): Promise<void> {
    const confirmed = await vscode.window.showWarningMessage(
        'Clear all shelves?',
        { modal: true },
        'Clear All'
    );

    if (confirmed === 'Clear All') {
        const shelfDir = getShelfDirectory(context);
        if (fs.existsSync(shelfDir)) {
            fs.rmSync(shelfDir, { recursive: true, force: true });
            fs.mkdirSync(shelfDir, { recursive: true });
            shelfProvider.clearAll();
            vscode.window.showInformationMessage('All shelves cleared');
        }
    }
}

/**
 * Automatically shelves changes when switching branches (called internally)
 */
export async function autoShelveChanges(context: vscode.ExtensionContext, fromBranch: string, toBranch: string): Promise<void> {
    const repoPath = await getGitRepositoryPath();
    if (!repoPath) {
        return;
    }

    // Get changed files using git status
    const changedFiles = await getChangedFilesFromGit(repoPath);
    if (changedFiles.length === 0) {
        return; // No changes to shelve
    }

    // Create automatic shelf name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const name = `Auto-saved from ${fromBranch} to ${toBranch} (${timestamp})`;

    try {
        const shelfEntry = await createShelfEntryFromGitFiles(context, name, changedFiles, repoPath);
        shelfProvider.addShelfEntry(shelfEntry);
        vscode.window.showInformationMessage(`Changes automatically shelved: ${name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Auto-shelve error:', error);
        // Don't show error to user for auto-save, just log it
    }
}

