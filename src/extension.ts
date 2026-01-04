import * as vscode from 'vscode';
import { ShelfProvider } from './shelfProvider';
import { ShelfItem } from './shelfItem';
import { 
    shelveChanges, 
    shelveSelectedFiles, 
    unshelveAll, 
    unshelveSelection,
    deleteShelfItem, 
    clearAll,
    autoShelveChanges,
    exportShelves,
    importShelves,
    setShelfProvider as setShelfProviderForOperations
} from './shelfOperations';
import { 
    viewDiff,
    setShelfProvider as setShelfProviderForDiff
} from './diffUtils';
import { getGitRepository, getCurrentBranch, getGitRepositoryPath } from './gitUtils';

let shelfProvider: ShelfProvider;
let currentBranch: string | null = null;
let branchChangeCheckInterval: NodeJS.Timeout | null = null;
let repositoryStateListener: vscode.Disposable | null = null;

export function activate(context: vscode.ExtensionContext): void {
    shelfProvider = new ShelfProvider(context);
    
    // Set shelf provider for operations and diff utilities
    setShelfProviderForOperations(shelfProvider);
    setShelfProviderForDiff(shelfProvider);
    
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

    const unshelveAllCommand = vscode.commands.registerCommand('shelf.unshelveAll', async (item: ShelfItem) => {
        await unshelveAll(context, item);
    });

    const unshelveSelectionCommand = vscode.commands.registerCommand('shelf.unshelveSelection', async (item: ShelfItem) => {
        await unshelveSelection(context, item);
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

    const exportCommand = vscode.commands.registerCommand('shelf.export', async () => {
        await exportShelves(context);
    });

    const importCommand = vscode.commands.registerCommand('shelf.import', async () => {
        await importShelves(context);
    });

    // Refresh shelf when workspace folders change (per project shelf)
    const workspaceChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        shelfProvider.refresh();
    });

    // Initialize branch tracking for auto-save feature
    initializeBranchTracking(context);

    // Listen for configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('shelf.autoSave')) {
            initializeBranchTracking(context);
        }
    });

    context.subscriptions.push(
        shelveChangesCommand,
        shelveSelectedFilesCommand,
        unshelveAllCommand,
        unshelveSelectionCommand,
        deleteCommand,
        clearAllCommand,
        viewDiffCommand,
        refreshCommand,
        exportCommand,
        importCommand,
        workspaceChangeListener,
        configChangeListener,
        {
            dispose: () => {
                if (branchChangeCheckInterval) {
                    clearInterval(branchChangeCheckInterval);
                    branchChangeCheckInterval = null;
                }
                if (repositoryStateListener) {
                    repositoryStateListener.dispose();
                    repositoryStateListener = null;
                }
            }
        }
    );
}

/**
 * Initializes branch tracking for auto-save feature
 */
async function initializeBranchTracking(context: vscode.ExtensionContext): Promise<void> {
    // Clear existing interval and listener if any
    if (branchChangeCheckInterval) {
        clearInterval(branchChangeCheckInterval);
        branchChangeCheckInterval = null;
    }
    
    if (repositoryStateListener) {
        repositoryStateListener.dispose();
        repositoryStateListener = null;
    }

    const config = vscode.workspace.getConfiguration('shelf');
    const autoSave = config.get<boolean>('autoSave', false);

    if (!autoSave) {
        currentBranch = null;
        return;
    }

    // Initialize current branch
    const repoPath = await getGitRepositoryPath();
    if (repoPath) {
        currentBranch = await getCurrentBranch(repoPath);
    }

    // Try to use Git repository state change event (more efficient)
    const gitRepo = getGitRepository();
    if (gitRepo && gitRepo.repository && gitRepo.repository.state.onDidChange) {
        repositoryStateListener = gitRepo.repository.state.onDidChange(async () => {
            await checkBranchChange(context);
        });
    }

    // Fallback: Check for branch changes periodically (every 2 seconds) if event-based tracking is not available
    if (!repositoryStateListener) {
        branchChangeCheckInterval = setInterval(async () => {
            await checkBranchChange(context);
        }, 2000);
    }
}

/**
 * Checks if branch has changed and triggers auto-save if enabled
 */
async function checkBranchChange(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('shelf');
    const autoSave = config.get<boolean>('autoSave', false);

    if (!autoSave) {
        return;
    }

    const repoPath = await getGitRepositoryPath();
    if (!repoPath) {
        currentBranch = null;
        return;
    }

    const newBranch = await getCurrentBranch(repoPath);
    
    // If branch changed and we had a previous branch
    if (newBranch && currentBranch && newBranch !== currentBranch) {
        const oldBranch = currentBranch;
        // Update branch first
        currentBranch = newBranch;
        
        // Auto-save changes (git usually preserves uncommitted changes when switching branches,
        // so we save them after the branch change for safety)
        await autoShelveChanges(context, oldBranch, newBranch);
    } else if (newBranch && !currentBranch) {
        // Initialize branch if it wasn't set
        currentBranch = newBranch;
    } else if (!newBranch) {
        // Reset if we're no longer in a git repo
        currentBranch = null;
    }
}

export function deactivate(): void {}
