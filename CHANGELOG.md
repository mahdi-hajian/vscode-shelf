# Changelog

All notable changes to this extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2025-12-14

### ✨ Added
- **Auto-save feature**: New `shelf.autoSave` configuration option
  - Automatically saves uncommitted changes to shelf when switching git branches
  - Creates shelf entries with descriptive names: `Auto-saved from {source-branch} to {target-branch} ({timestamp})`
  - Uses efficient Git repository state events for branch change detection
  - Falls back to polling mechanism (every 2 seconds) when event-based tracking is unavailable
  - Default value: `false` (disabled by default for backward compatibility)
  - Respects configuration changes without requiring extension restart

### 🔧 Technical Changes
- Added `getCurrentBranch()` utility function in `gitUtils.ts`
- Added `autoShelveChanges()` function in `shelfOperations.ts` for automatic shelf creation
- Implemented branch tracking system with configuration change listener in `extension.ts`
- Added proper cleanup for branch tracking resources on extension deactivation

### 📝 How to Use
1. Open VS Code Settings (Ctrl+, or Cmd+,)
2. Search for `shelf.autoSave`
3. Enable the setting by checking the box or setting it to `true`
4. Your uncommitted changes will now be automatically saved when you switch git branches

---

## [0.2.2] - Previous Release

### Features
- ✅ Manual shelving functionality
- ✅ Shelve all changes or selected files
- ✅ Unshelve functionality (all or selected files)
- ✅ View diff for shelved files
- ✅ Delete shelf entries
- ✅ Clear all shelves
- ✅ Per-project shelf storage
- ✅ Maximum items limit configuration (`shelf.maxItems`)

### Configuration Options
- `shelf.maxItems`: Maximum number of items to keep in shelf (default: 50)
