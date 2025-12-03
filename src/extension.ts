import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShelfProvider } from './shelfProvider';
import { ShelfItem, ShelfEntry } from './shelfItem';

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

    const shelveSelectedFilesCommand = vscode.commands.registerCommand('shelf.shelveSelectedFiles', async (uri?: vscode.Uri | vscode.SourceControlResourceState) => {
        await shelveSelectedFiles(context, uri);
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

async function shelveChanges(context: vscode.ExtensionContext) {
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

    const changes = repository.state.workingTreeChanges;
    if (changes.length === 0) {
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
        const shelfEntry = await createShelfEntry(context, name, changes, repository);
        shelfProvider.addShelfEntry(shelfEntry);
        vscode.window.showInformationMessage(`Changes shelved: ${name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to shelve changes: ${errorMessage}`);
        console.error('Shelve error:', error);
    }
}

async function shelveSelectedFiles(context: vscode.ExtensionContext, uri?: vscode.Uri | vscode.SourceControlResourceState) {
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

    let filesToShelve: vscode.Uri[] = [];
    let changes: vscode.SourceControlResourceState[] = [];
    
    if (uri) {
        // Check if uri is a SourceControlResourceState
        if ('resourceUri' in uri && uri.resourceUri) {
            // It's a SourceControlResourceState from context menu
            changes = [uri as vscode.SourceControlResourceState];
        } else if (uri instanceof vscode.Uri) {
            // It's a Uri
            filesToShelve = [uri];
            changes = repository.state.workingTreeChanges.filter((change: vscode.SourceControlResourceState) => 
                change.resourceUri && change.resourceUri.fsPath === uri.fsPath
            );
        }
    } else {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            filesToShelve = [activeEditor.document.uri];
            changes = repository.state.workingTreeChanges.filter((change: vscode.SourceControlResourceState) => 
                change.resourceUri && change.resourceUri.fsPath === activeEditor.document.uri.fsPath
            );
        } else {
            vscode.window.showInformationMessage('No file selected');
            return;
        }
    }

    if (changes.length === 0) {
        vscode.window.showInformationMessage('No changes to shelve for selected files');
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
        const shelfEntry = await createShelfEntry(context, name, changes, repository);
        shelfProvider.addShelfEntry(shelfEntry);
        vscode.window.showInformationMessage(`Changes shelved: ${name}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to shelve changes: ${errorMessage}`);
        console.error('Shelve error:', error);
    }
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

    for (const change of changes) {
        if (!change.resourceUri) {
            console.warn('Skipping change with undefined resourceUri');
            continue;
        }

        try {
            const fileUri = change.resourceUri;
            const relativePath = path.relative(workspacePath, fileUri.fsPath);
            
            // Skip if relative path is invalid (outside workspace)
            if (relativePath.startsWith('..')) {
                console.warn(`Skipping file outside workspace: ${fileUri.fsPath}`);
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
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`Failed to shelve file ${change.resourceUri.fsPath}: ${errorMsg}`);
            // Continue with other files
        }
    }

    if (Object.keys(files).length === 0) {
        throw new Error('No files were successfully shelved. Make sure you have uncommitted changes.');
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
        // Refresh the workspace
        vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
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

    const filePath = item.filePath;
    if (!filePath) {
        vscode.window.showErrorMessage('No file selected');
        return;
    }

    const relativePath = filePath;
    const shelfFilePath = path.join(entryDir, relativePath);
    const currentFilePath = path.join(workspacePath, relativePath);

    if (!fs.existsSync(shelfFilePath)) {
        vscode.window.showErrorMessage('Shelf file not found');
        return;
    }

    const shelfUri = vscode.Uri.file(shelfFilePath);
    const currentUri = fs.existsSync(currentFilePath) 
        ? vscode.Uri.file(currentFilePath)
        : undefined;

    if (currentUri) {
        await vscode.commands.executeCommand(
            'vscode.diff',
            currentUri,
            shelfUri,
            `Shelf: ${entry.name} - ${path.basename(relativePath)}`
        );
    } else {
        // File doesn't exist in workspace, just open the shelf version
        const doc = await vscode.workspace.openTextDocument(shelfUri);
        await vscode.window.showTextDocument(doc);
    }
}

