import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ShelfItem, ShelfEntry } from './shelfItem';

export class ShelfProvider implements vscode.TreeDataProvider<ShelfItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ShelfItem | undefined | null | void> = new vscode.EventEmitter<ShelfItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ShelfItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private entries: ShelfEntry[] = [];
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadShelfEntries();
    }

    getContext(): vscode.ExtensionContext {
        return this.context;
    }

    refresh(): void {
        this.loadShelfEntries();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ShelfItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ShelfItem): Thenable<ShelfItem[]> {
        if (!element) {
            // Root level - return all shelf entries
            return Promise.resolve(
                this.entries
                    .sort((a, b) => b.timestamp - a.timestamp)
                    .map(entry => new ShelfItem(entry))
            );
        } else {
            // Return files for this shelf entry
            const entry = element.entry;
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return Promise.resolve([]);
            }

            const fileItems = Object.keys(entry.files).map(relativePath => 
                new ShelfItem(entry, relativePath)
            );
            return Promise.resolve(fileItems);
        }
    }

    addShelfEntry(entry: ShelfEntry): void {
        this.entries.push(entry);
        this.saveShelfEntries();
        this._onDidChangeTreeData.fire();
    }

    removeShelfEntry(entryId: string): void {
        this.entries = this.entries.filter(e => e.id !== entryId);
        this.saveShelfEntries();
        this._onDidChangeTreeData.fire();
    }

    clearAll(): void {
        this.entries = [];
        this.saveShelfEntries();
        this._onDidChangeTreeData.fire();
    }

    private loadShelfEntries(): void {
        const shelfDir = path.join(this.context.globalStoragePath, 'shelf');
        this.entries = [];

        if (!fs.existsSync(shelfDir)) {
            return;
        }

        const dirs = fs.readdirSync(shelfDir);
        for (const dir of dirs) {
            const entryFile = path.join(shelfDir, dir, 'entry.json');
            if (fs.existsSync(entryFile)) {
                try {
                    const content = fs.readFileSync(entryFile, 'utf-8');
                    const entry: ShelfEntry = JSON.parse(content);
                    this.entries.push(entry);
                } catch (error) {
                    console.error(`Failed to load shelf entry ${dir}:`, error);
                }
            }
        }

        // Sort by timestamp (newest first)
        this.entries.sort((a, b) => b.timestamp - a.timestamp);

        // Apply max items limit
        const config = vscode.workspace.getConfiguration('shelf');
        const maxItems = config.get<number>('maxItems', 50);
        if (this.entries.length > maxItems) {
            const toRemove = this.entries.slice(maxItems);
            for (const entry of toRemove) {
                const entryDir = path.join(shelfDir, entry.id);
                if (fs.existsSync(entryDir)) {
                    fs.rmSync(entryDir, { recursive: true, force: true });
                }
            }
            this.entries = this.entries.slice(0, maxItems);
        }
    }

    private saveShelfEntries(): void {
        // Entries are already saved when created, this is just for metadata
        // In a real implementation, you might want to maintain an index file
    }
}

