import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShelfItem } from './shelfItem';
import { ShelfProvider } from './shelfProvider';
import { 
    getGitRepositoryPath, 
    getChangedFilesFromGit, 
    getGitStatusMap, 
    getStatusText,
    getGitRepository,
    GitFileStatus 
} from './gitUtils';
import { createShelfEntryFromGitFiles, createShelfEntry } from './shelfStorage';

let shelfProvider: ShelfProvider;

export function setShelfProvider(provider: ShelfProvider) {
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
 * Unshelves files from a shelf entry
 */
export async function unshelve(context: vscode.ExtensionContext, item: ShelfItem): Promise<void> {
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
        const entryDir = path.join(context.globalStoragePath, 'shelf', entry.id);
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
        const shelfDir = path.join(context.globalStoragePath, 'shelf');
        if (fs.existsSync(shelfDir)) {
            fs.rmSync(shelfDir, { recursive: true, force: true });
            fs.mkdirSync(shelfDir, { recursive: true });
            shelfProvider.clearAll();
            vscode.window.showInformationMessage('All shelves cleared');
        }
    }
}

