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
    entryDir: string,
    forceOverride: boolean
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
            const result = await restoreSingleFile(entry, relativePath, workspacePath, entryDir, forceOverride);
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
    entryDir: string,
    forceOverride: boolean
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

    if (forceOverride) {
        fs.writeFileSync(targetPath, shelfContent);
        return { status: 'restored', conflict: false };
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
 * Checks if a file is JSON based on its extension
 */
function isJsonFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.json' || ext === '.jsonc';
}

/**
 * Parses JSON with error handling
 */
function tryParseJson(text: string): { success: boolean; data?: any; error?: string } {
    try {
        const data = JSON.parse(text);
        return { success: true, data };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Deep compares two JSON objects and returns paths of conflicting properties
 */
function findJsonConflicts(current: any, shelf: any, path: string[] = []): string[][] {
    const conflicts: string[][] = [];

    // If types are different, it's a conflict
    if (typeof current !== typeof shelf) {
        conflicts.push(path);
        return conflicts;
    }

    // If both are primitives and different, it's a conflict
    if (current !== null && shelf !== null && typeof current !== 'object') {
        if (current !== shelf) {
            conflicts.push(path);
        }
        return conflicts;
    }

    // Handle null values
    if (current === null || shelf === null) {
        if (current !== shelf) {
            conflicts.push(path);
        }
        return conflicts;
    }

    // Both are objects/arrays
    if (Array.isArray(current) && Array.isArray(shelf)) {
        // For arrays, compare element by element
        const maxLength = Math.max(current.length, shelf.length);
        for (let i = 0; i < maxLength; i++) {
            if (i >= current.length || i >= shelf.length) {
                conflicts.push([...path, String(i)]);
            } else {
                conflicts.push(...findJsonConflicts(current[i], shelf[i], [...path, String(i)]));
            }
        }
    } else if (typeof current === 'object' && typeof shelf === 'object') {
        // Get all unique keys from both objects
        const allKeys = new Set([...Object.keys(current), ...Object.keys(shelf)]);
        
        for (const key of allKeys) {
            const currentHasKey = key in current;
            const shelfHasKey = key in shelf;
            
            if (!currentHasKey || !shelfHasKey) {
                // Key exists in one but not the other
                conflicts.push([...path, key]);
            } else {
                // Key exists in both, recursively check
                conflicts.push(...findJsonConflicts(current[key], shelf[key], [...path, key]));
            }
        }
    }

    return conflicts;
}

/**
 * Gets a value from a nested object using a path array
 */
function getValueByPath(obj: any, path: string[]): any {
    let current = obj;
    for (const key of path) {
        if (current === null || current === undefined) {
            return undefined;
        }
        if (Array.isArray(current) && /^\d+$/.test(key)) {
            current = current[parseInt(key, 10)];
        } else if (typeof current === 'object') {
            current = current[key];
        } else {
            return undefined;
        }
    }
    return current;
}

/**
 * Sets a value in a nested object using a path array
 */
function setValueByPath(obj: any, path: string[], value: any): void {
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (Array.isArray(current) && /^\d+$/.test(key)) {
            const index = parseInt(key, 10);
            if (!current[index]) {
                current[index] = {};
            }
            current = current[index];
        } else if (typeof current === 'object') {
            if (!current[key]) {
                current[key] = {};
            }
            current = current[key];
        }
    }
    const lastKey = path[path.length - 1];
    if (Array.isArray(current) && /^\d+$/.test(lastKey)) {
        current[parseInt(lastKey, 10)] = value;
    } else if (typeof current === 'object') {
        current[lastKey] = value;
    }
}

/**
 * Inserts conflict markers for JSON files by comparing structure
 */
function insertJsonConflictMarkers(
    targetPath: string,
    entryName: string,
    currentText: string,
    shelfText: string
): void {
    const currentParse = tryParseJson(currentText);
    const shelfParse = tryParseJson(shelfText);

    // If either file is invalid JSON, fall back to line-based diff
    if (!currentParse.success || !shelfParse.success) {
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
        return;
    }

    // Find conflicting paths
    const conflictPaths = findJsonConflicts(currentParse.data, shelfParse.data);
    
    if (conflictPaths.length === 0) {
        // No conflicts, use current version
        fs.writeFileSync(targetPath, currentText, 'utf8');
        return;
    }

    // Build JSON with conflict markers at conflicting properties
    const currentData = currentParse.data;
    const shelfData = shelfParse.data;
    const lineEnding = detectLineEnding(currentText, shelfText) ?? os.EOL;
    const resultText = buildJsonWithConflicts(currentData, shelfData, conflictPaths, entryName, lineEnding);
    
    fs.writeFileSync(targetPath, resultText, 'utf8');
}

/**
 * Builds JSON string with conflict markers inserted at conflicting properties
 */
function buildJsonWithConflicts(
    current: any,
    shelf: any,
    conflictPaths: string[][],
    entryName: string,
    lineEnding: string
): string {
    // Create a set of conflict paths for quick lookup
    const conflictSet = new Set(conflictPaths.map(p => p.join('.')));
    
    function buildValue(currentVal: any, shelfVal: any, path: string[], indent: number): string {
        const pathKey = path.join('.');
        const isConflict = conflictSet.has(pathKey);
        const indentStr = '  '.repeat(indent);
        
        if (isConflict) {
            // This is a conflict - show both versions
            const currentStr = currentVal === undefined 
                ? '(deleted)' 
                : JSON.stringify(currentVal, null, 2)
                    .split('\n')
                    .map((line, i) => i === 0 ? line : indentStr + '  ' + line)
                    .join('\n');
            const shelfStr = shelfVal === undefined 
                ? '(deleted)' 
                : JSON.stringify(shelfVal, null, 2)
                    .split('\n')
                    .map((line, i) => i === 0 ? line : indentStr + '  ' + line)
                    .join('\n');
            
            return `<<<<<<< Current Workspace${lineEnding}${indentStr}  ${currentStr}${lineEnding}${indentStr}=======${lineEnding}${indentStr}  ${shelfStr}${lineEnding}${indentStr}>>>>>>> Shelf: ${entryName}${lineEnding}`;
        }
        
        // Not a conflict - use current value, but need to handle structure
        const value = currentVal;
        
        if (value === null) {
            return 'null';
        }
        
        if (value === undefined) {
            return 'undefined';
        }
        
        if (typeof value === 'string') {
            return JSON.stringify(value);
        }
        
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '[]';
            }
            const shelfArray = Array.isArray(shelfVal) ? shelfVal : [];
            const maxLength = Math.max(value.length, shelfArray.length);
            const items: string[] = [];
            
            for (let index = 0; index < maxLength; index++) {
                const itemPath = [...path, String(index)];
                const currentItem = value[index];
                const shelfItem = shelfArray[index];
                
                if (index < value.length) {
                    items.push(indentStr + '  ' + buildValue(currentItem, shelfItem, itemPath, indent + 1));
                }
            }
            
            return '[\n' + items.join(',\n') + '\n' + indentStr + ']';
        }
        
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            const shelfKeys = shelfVal && typeof shelfVal === 'object' ? Object.keys(shelfVal) : [];
            const allKeys = new Set([...keys, ...shelfKeys]);
            
            if (allKeys.size === 0) {
                return '{}';
            }
            
            const pairs: string[] = [];
            for (const key of allKeys) {
                const keyPath = [...path, key];
                const currentKeyValue = value[key];
                const shelfKeyValue = shelfVal && typeof shelfVal === 'object' ? shelfVal[key] : undefined;
                const keyValue = buildValue(currentKeyValue, shelfKeyValue, keyPath, indent + 1);
                pairs.push(indentStr + '  ' + JSON.stringify(key) + ': ' + keyValue);
            }
            
            return '{\n' + pairs.join(',\n') + '\n' + indentStr + '}';
        }
        
        return JSON.stringify(value);
    }
    
    return buildValue(current, shelf, [], 0);
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

    // Check if this is a JSON file and handle it specially
    if (isJsonFile(targetPath)) {
        insertJsonConflictMarkers(targetPath, entryName, currentText, shelfText);
        return;
    }

    // For non-JSON files, use line-based diff
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
    const config = vscode.workspace.getConfiguration('shelf');
    const forceOverride = config.get<boolean>('unshelve.forceOverride', false);

    const relativePaths = (item.filePath ? [item.filePath] : Object.keys(entry.files)).filter(Boolean);
    if (relativePaths.length === 0) {
        vscode.window.showWarningMessage('No files found in this shelf entry.');
        return;
    }

    const summary = await restoreFilesFromShelf(entry, relativePaths, workspacePath, entryDir, forceOverride);
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
    const config = vscode.workspace.getConfiguration('shelf');
    const forceOverride = config.get<boolean>('unshelve.forceOverride', false);

    const summary = await restoreFilesFromShelf(entry, selectedPaths, workspacePath, entryDir, forceOverride);
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

/**
 * Export interface for shelf export data
 */
interface ExportedShelfData {
    version: string;
    exportDate: number;
    entries: Array<{
        entry: ShelfEntry;
        files: { [relativePath: string]: string }; // base64 encoded file contents
    }>;
}

/**
 * Exports all shelves to a JSON file
 */
export async function exportShelves(context: vscode.ExtensionContext): Promise<void> {
    const shelfDir = getShelfDirectory(context);
    if (!fs.existsSync(shelfDir)) {
        vscode.window.showInformationMessage('No shelves to export');
        return;
    }

    // Get all shelf entries
    const entries: ShelfEntry[] = [];
    const dirs = fs.readdirSync(shelfDir);
    for (const dir of dirs) {
        const entryFile = path.join(shelfDir, dir, 'entry.json');
        if (fs.existsSync(entryFile)) {
            try {
                const content = fs.readFileSync(entryFile, 'utf-8');
                const entry: ShelfEntry = JSON.parse(content);
                entries.push(entry);
            } catch (error) {
                console.error(`Failed to load shelf entry ${dir}:`, error);
            }
        }
    }

    if (entries.length === 0) {
        vscode.window.showInformationMessage('No shelves to export');
        return;
    }

    // Build export data with file contents
    const exportData: ExportedShelfData = {
        version: '1.0',
        exportDate: Date.now(),
        entries: []
    };

    for (const entry of entries) {
        const entryDir = path.join(shelfDir, entry.id);
        const files: { [relativePath: string]: string } = {};

        // Read all file contents and encode as base64
        for (const relativePath of Object.keys(entry.files)) {
            const shelfFilePath = path.join(entryDir, relativePath);
            if (fs.existsSync(shelfFilePath)) {
                try {
                    const fileContent = fs.readFileSync(shelfFilePath);
                    files[relativePath] = fileContent.toString('base64');
                } catch (error) {
                    console.error(`Failed to read file ${relativePath}:`, error);
                }
            }
        }

        exportData.entries.push({
            entry: entry,
            files: files
        });
    }

    // Ask user for save location
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`shelf-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.json`),
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        },
        saveLabel: 'Export Shelves'
    });

    if (!uri) {
        return; // User cancelled
    }

    try {
        const jsonContent = JSON.stringify(exportData, null, 2);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonContent, 'utf8'));
        vscode.window.showInformationMessage(`Successfully exported ${entries.length} shelf(es) to ${path.basename(uri.fsPath)}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to export shelves: ${errorMessage}`);
        console.error('Export error:', error);
    }
}

/**
 * Imports shelves from a JSON file
 */
export async function importShelves(context: vscode.ExtensionContext): Promise<void> {
    // Ask user to select import file
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
            'JSON Files': ['json'],
            'All Files': ['*']
        },
        openLabel: 'Import Shelves'
    });

    if (!uris || uris.length === 0) {
        return; // User cancelled
    }

    const importUri = uris[0];

    try {
        // Read the import file
        const fileContent = await vscode.workspace.fs.readFile(importUri);
        const jsonContent = Buffer.from(fileContent).toString('utf8');
        const importData: ExportedShelfData = JSON.parse(jsonContent);

        // Validate structure
        if (!importData.version || !importData.entries || !Array.isArray(importData.entries)) {
            throw new Error('Invalid export file format');
        }

        if (importData.entries.length === 0) {
            vscode.window.showInformationMessage('No shelves found in import file');
            return;
        }

        // Ask for confirmation
        const confirmed = await vscode.window.showWarningMessage(
            `Import ${importData.entries.length} shelf(es)? This will add them to your current shelves.`,
            { modal: true },
            'Import'
        );

        if (confirmed !== 'Import') {
            return;
        }

        const shelfDir = getShelfDirectory(context);
        if (!fs.existsSync(shelfDir)) {
            fs.mkdirSync(shelfDir, { recursive: true });
        }

        let importedCount = 0;
        let skippedCount = 0;

        // Import each shelf entry
        for (const exportedEntry of importData.entries) {
            const entry = exportedEntry.entry;
            
            // Check if entry already exists
            const existingEntryDir = path.join(shelfDir, entry.id);
            if (fs.existsSync(existingEntryDir)) {
                // Entry already exists, skip or create new ID
                const newId = `${Date.now()}-${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
                entry.id = newId;
            }

            const entryDir = path.join(shelfDir, entry.id);
            fs.mkdirSync(entryDir, { recursive: true });

            // Restore file contents
            for (const relativePath of Object.keys(exportedEntry.files)) {
                const fileContentBase64 = exportedEntry.files[relativePath];
                const fileContent = Buffer.from(fileContentBase64, 'base64');
                
                const fileDir = path.join(entryDir, path.dirname(relativePath));
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }
                
                const filePath = path.join(entryDir, relativePath);
                fs.writeFileSync(filePath, fileContent);
            }

            // Save entry.json
            const entryFile = path.join(entryDir, 'entry.json');
            fs.writeFileSync(entryFile, JSON.stringify(entry, null, 2));

            // Add to shelf provider
            shelfProvider.addShelfEntry(entry);
            importedCount++;
        }

        vscode.window.showInformationMessage(
            `Successfully imported ${importedCount} shelf(es)${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}`
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to import shelves: ${errorMessage}`);
        console.error('Import error:', error);
    }
}

