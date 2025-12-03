import * as vscode from 'vscode';
import * as path from 'path';

export interface ShelfEntry {
    id: string;
    name: string;
    timestamp: number;
    files: { [relativePath: string]: string };
    workspacePath: string;
}

export class ShelfItem extends vscode.TreeItem {
    constructor(
        public readonly entry: ShelfEntry,
        public readonly filePath?: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(
            filePath ? path.basename(filePath) : entry.name,
            filePath ? vscode.TreeItemCollapsibleState.None : vscode.TreeItemCollapsibleState.Collapsed
        );

        this.contextValue = filePath ? 'shelfItemFile' : 'shelfItemEntry';
        this.tooltip = filePath 
            ? `${entry.name} - ${filePath}`
            : `${entry.name} (${Object.keys(entry.files).length} file(s))`;
        
        if (!filePath) {
            // Parent item (shelf entry)
            const date = new Date(entry.timestamp);
            this.description = date.toLocaleString();
            this.iconPath = new vscode.ThemeIcon('archive');
        } else {
            // File item
            this.resourceUri = vscode.Uri.file(filePath);
            this.command = {
                command: 'shelf.viewDiff',
                title: 'View Diff',
                arguments: [this]
            };
        }
    }
}

