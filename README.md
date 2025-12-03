# Shelf - VS Code Extension

A VS Code extension that provides a "Shelf" feature similar to WebStorm's Shelf, allowing you to temporarily save changes without committing them.

## Features

- **Shelve Changes**: Save your current working tree changes to the shelf
- **Shelve Selected Files**: Shelve changes from specific files only
- **Unshelve**: Restore shelved changes back to your workspace
- **View Diff**: Compare shelved files with current workspace files
- **Tree View**: Browse all your shelved changes in the Explorer sidebar
- **Delete**: Remove individual shelf entries
- **Clear All**: Remove all shelved changes

## Usage

### Shelving Changes

1. **Shelve All Changes**: 
   - Open the Source Control view
   - Click the "Shelve Changes" button in the SCM title bar
   - Or use Command Palette: `Shelf: Shelve Changes`

2. **Shelve Selected Files**:
   - Right-click on a file in the Source Control view
   - Select "Shelve Selected Files"
   - Or use Command Palette: `Shelf: Shelve Selected Files`

3. When prompted, enter a name for your shelf entry (e.g., "WIP feature X")

### Viewing Shelved Changes

- Open the "Shelf" view in the Explorer sidebar
- Expand a shelf entry to see all files
- Click on a file to view the diff

### Unshelving Changes

- Right-click on a shelf entry or file in the Shelf view
- Select "Unshelve"
- Files will be restored to your workspace

### Managing Shelves

- **Delete**: Right-click on a shelf entry and select "Delete"
- **Clear All**: Click the "Clear All" button in the Shelf view title bar
- **Refresh**: Click the refresh button to reload shelf entries

## Configuration

- `shelf.autoSave`: Automatically save changes to shelf when switching branches (default: false)
- `shelf.maxItems`: Maximum number of items to keep in shelf (default: 50)

## Requirements

- VS Code 1.80.0 or higher
- Git extension (built-in) must be enabled

## Installation

1. Clone this repository
2. Run `npm install`
3. Press `F5` to open a new Extension Development Host window
4. Or package the extension: `vsce package`

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch
```

## License

MIT

