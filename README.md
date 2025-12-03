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
   - Open the Shelf view in the Explorer sidebar
   - Click the "Shelve Selected Files" button in the view title bar
   - Select files from the quick pick dialog
   - Or use Command Palette: `Shelf: Shelve Selected Files`

3. When prompted, enter a name for your shelf entry (e.g., "WIP feature X")

### Viewing Shelved Changes

- Open the "Shelf" view in the Explorer sidebar (under Source Control)
- Expand a shelf entry to see all files
- Click on a file to view the diff between current and shelved version

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
- A Git repository in your workspace

## Installation

### From VSIX

1. Download the `vscode-shelf-0.1.0.vsix` file
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

## Development

### Project Structure

The extension is organized into modular files for better maintainability:

```
src/
├── extension.ts          # Main entry point, command registration
├── shelfProvider.ts      # Tree data provider for Shelf view
├── shelfItem.ts          # Tree item model and ShelfEntry interface
├── gitUtils.ts           # Git repository utilities
├── shelfStorage.ts       # Shelf entry creation and file storage
├── shelfOperations.ts    # Core shelf operations (shelve, unshelve, delete)
└── diffUtils.ts          # Diff viewing utilities
```

### Building

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes (auto-compile)
npm run watch
```

### Packaging

```bash
# Package the extension into a VSIX file
vsce package
```

The VSIX file will be created in the project root directory.

### Code Style

- All methods have explicit access modifiers (`public`, `private`)
- All methods have explicit return types
- Functions are organized by responsibility into separate modules
- TypeScript strict mode is enabled

## Architecture

### Core Components

1. **ShelfProvider**: Manages the tree view and shelf entries lifecycle
2. **Git Utils**: Handles Git repository detection and status parsing
3. **Shelf Storage**: Creates and manages shelf entry files on disk
4. **Shelf Operations**: Implements shelve, unshelve, delete, and clear operations
5. **Diff Utils**: Provides diff viewing functionality

### Data Storage

Shelf entries are stored in:
```
{globalStoragePath}/shelf/{entryId}/
├── entry.json          # Entry metadata
└── {relativePath}      # Shelved file contents
```

## Commands

| Command | Description |
|---------|-------------|
| `shelf.shelveChanges` | Shelve all changes in the repository |
| `shelf.shelveSelectedFiles` | Shelve selected files |
| `shelf.unshelve` | Restore shelved changes |
| `shelf.viewDiff` | View diff between current and shelved file |
| `shelf.delete` | Delete a shelf entry |
| `shelf.clearAll` | Clear all shelf entries |
| `shelf.refresh` | Refresh the shelf view |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Links

- **Repository**: [https://github.com/mahdi-hajian/vscode-shelf](https://github.com/mahdi-hajian/vscode-shelf)
- **Issues**: [https://github.com/mahdi-hajian/vscode-shelf/issues](https://github.com/mahdi-hajian/vscode-shelf/issues)

## License

MIT

## Author

mahdihajian
