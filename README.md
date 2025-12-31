# Shelf - VS Code Extension

A VS Code extension that provides a "Shelf" feature similar to WebStorm's Shelf, allowing you to temporarily save changes without committing them.

## Features

- **Shelve Changes**: Save your current working tree changes to the shelf
- **Shelve Selected Files**: Shelve changes from specific files only
- **Unshelve All**: Restore all shelved changes back to your workspace
- **Unshelve Selection**: Select and restore specific files from a shelf entry
- **View Diff**: Compare shelved files with current workspace files
- **Tree View**: Browse all your shelved changes in the Explorer sidebar
- **Per-Project Shelf**: Each workspace has its own separate shelf storage
- **Delete**: Remove individual shelf entries
- **Clear All**: Remove all shelved changes

## Usage

### Shelving Changes

1. **Shelve All Changes**: 
   - Open the Source Control view
   - Click the "Shelve Changes" button in the SCM title bar
   - Or use Command Palette: `Shelf: Shelve Changes`

2. **Shelve Selected Files**:
   - Open the Shelf view in the Explorer sidebar
   - Click the "Shelve Selected Files" button in the view title bar
   - Select files from the quick pick dialog (use Space to select multiple)
   - Or use Command Palette: `Shelf: Shelve Selected Files`

3. When prompted, enter a name for your shelf entry (e.g., "WIP feature X")

### Viewing Shelved Changes

- Open the "Shelf" view in the Explorer sidebar (under Source Control)
- Expand a shelf entry to see all files
- Click on a file to view the diff between current and shelved version

### Unshelving Changes

1. **Unshelve All**:
   - Right-click on a shelf entry in the Shelf view
   - Select "Unshelve All"
   - All files in the shelf entry will be restored to your workspace

2. **Unshelve Selection**:
   - Right-click on a shelf entry in the Shelf view
   - Select "Unshelve Selection"
   - A quick pick dialog will appear with all files in the shelf entry
   - Select the files you want to restore (use Space to select multiple)
   - Selected files will be restored to your workspace
   - Tip: set `shelf.unshelve.forceOverride` to `true` if you want this command to overwrite files without showing conflict prompts

### Managing Shelves

- **Delete**: Right-click on a shelf entry or file and select "Delete"
- **Clear All**: Click the "Clear All" button in the Shelf view title bar
- **Refresh**: Click the refresh button to reload shelf entries

### Per-Project Shelf

Each workspace has its own separate shelf storage. When you switch between different projects, you'll only see the shelf entries for the current workspace. This ensures that shelf entries from different projects don't interfere with each other.

## Configuration

- `shelf.autoSave`: Automatically save changes to shelf when switching branches (default: false)
- `shelf.maxItems`: Maximum number of items to keep in shelf (default: 50)
- `shelf.unshelve.forceOverride`: Always overwrite workspace files when unshelving (skip conflict prompts)

## Requirements

- VS Code 1.80.0 or higher
- Git extension (built-in) must be enabled
- A Git repository in your workspace

## Installation

### From VSIX

1. Download the `vscode-shelf-0.2.0.vsix` file
2. Open VS Code
3. Go to Extensions view (Ctrl+Shift+X)
4. Click the "..." menu and select "Install from VSIX..."
5. Select the downloaded VSIX file

### From Source

1. Clone this repository
   ```bash
   git clone https://github.com/mahdi-hajian/vscode-shelf.git
   cd vscode-shelf
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Compile the extension
   ```bash
   npm run compile
   ```

4. Press `F5` to open a new Extension Development Host window

## Commands

| Command | Description |
|---------|-------------|
| `shelf.shelveChanges` | Shelve all changes in the repository |
| `shelf.shelveSelectedFiles` | Shelve selected files |
| `shelf.unshelveAll` | Restore all shelved changes from a shelf entry |
| `shelf.unshelveSelection` | Select and restore specific files from a shelf entry |
| `shelf.viewDiff` | View diff between current and shelved file |
| `shelf.delete` | Delete a shelf entry |
| `shelf.clearAll` | Clear all shelf entries |
| `shelf.refresh` | Refresh the shelf view |
