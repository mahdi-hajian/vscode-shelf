import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitFileStatus {
    path: string;
    status: string; // e.g., "M ", " D", "??", "A ", etc.
    isDeleted: boolean;
    isUntracked: boolean;
}

/**
 * Gets the path to the git repository root
 */
export async function getGitRepositoryPath(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }

    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        return null;
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git || !git.repositories || git.repositories.length === 0) {
        return null;
    }

    const repository = git.repositories[0];
    return repository.rootUri.fsPath;
}

/**
 * Gets all changed files from git status
 */
export async function getChangedFilesFromGit(repoPath: string): Promise<GitFileStatus[]> {
    try {
        // Get all changed files (modified, added, deleted, untracked)
        const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
        const lines = stdout.trim().split('\n').filter(line => line.trim()).map(line => line.trim());
        
        const files: GitFileStatus[] = [];
        for (const line of lines) {
            // git status --porcelain format: XY filename
            // X = index status, Y = working tree status
            const status = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            
            // Include modified (M), added (A), deleted (D), renamed (R), copied (C), untracked (?)
            if (status[1] !== ' ' || status[0] !== ' ') {
                const isDeleted = status[0] === 'D' || status[1] === 'D';
                const isUntracked = status === '??';
                files.push({
                    path: filePath,
                    status: status,
                    isDeleted: isDeleted,
                    isUntracked: isUntracked
                });
            }
        }
        
        return files;
    } catch (error) {
        console.error('Error getting git status:', error);
        return [];
    }
}

/**
 * Gets git status map from repository path
 */
export async function getGitStatusMap(repoPath: string): Promise<Map<string, string>> {
    const gitStatusMap = new Map<string, string>();
    
    try {
        const { stdout } = await execAsync('git status --porcelain', { cwd: repoPath });
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        for (const line of lines) {
            const status = line.substring(0, 2);
            const filePath = line.substring(2).trim();
            gitStatusMap.set(filePath, status);
        }
    } catch (error) {
        console.error('Error getting git status:', error);
    }
    
    return gitStatusMap;
}

/**
 * Gets human-readable status text from git status code
 */
export function getStatusText(gitStatus: string | undefined): string {
    if (!gitStatus) {
        return 'Changed';
    }
    
    if (gitStatus[1] === 'M' || gitStatus[0] === 'M') {
        return 'Modified';
    } else if (gitStatus[1] === 'A' || gitStatus[0] === 'A') {
        return 'Added';
    } else if (gitStatus[1] === 'D' || gitStatus[0] === 'D') {
        return 'Deleted';
    } else if (gitStatus === '??') {
        return 'Untracked';
    } else if (gitStatus[1] === 'R' || gitStatus[0] === 'R') {
        return 'Renamed';
    }
    
    return 'Changed';
}

/**
 * Gets git API and repository
 */
export function getGitRepository(): { git: any; repository: any } | null {
    const gitExtension = vscode.extensions.getExtension('vscode.git');
    if (!gitExtension) {
        return null;
    }

    const git = gitExtension.exports.getAPI(1);
    if (!git) {
        return null;
    }

    const repository = git.repositories[0];
    if (!repository) {
        return null;
    }

    return { git, repository };
}

