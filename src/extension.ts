import * as vscode from 'vscode';
import { ShelfProvider } from './shelfProvider';
import { ShelfItem } from './shelfItem';
import { 
    shelveChanges, 
    shelveSelectedFiles, 
    unshelve, 
    deleteShelfItem, 
    clearAll,
    setShelfProvider as setShelfProviderForOperations
} from './shelfOperations';
import { 
    viewDiff,
    setShelfProvider as setShelfProviderForDiff
} from './diffUtils';

let shelfProvider: ShelfProvider;

export function activate(context: vscode.ExtensionContext) {
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
