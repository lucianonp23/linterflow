import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');
import { GithubRepoRef } from './dto/import-repo.dto';

/**
 * Strict tree-node contract shared with the frontend file tree
 * (public/index.html → FileTreeItem component).
 */
export interface FileTreeNode {
  name: string;
  type: 'file' | 'directory';
  path: string;
  children?: FileTreeNode[];
}

export interface ImportResult {
  importId: string;
  owner: string;
  repo: string;
  tree: FileTreeNode;
}

/** Resolved target for the refactoring pipeline. */
export interface AnalysisTarget {
  /** Absolute directory the Producer will scan. */
  directory: string;
  /** Glob pattern relative to `directory` ('**\/*.ts' or a single file name). */
  pattern: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  /** Root folder where every import lives, isolated per-UUID: temp/{uuid}/ */
  readonly tempRoot = path.resolve(process.cwd(), 'temp');

  /**
   * Downloads a public GitHub repository as a zipball, extracts it into an
   * isolated temp/{uuid}/ directory and returns the mapped file tree.
   */
  public async importRepository(ref: GithubRepoRef): Promise<ImportResult> {
    const { owner, repo } = ref;
    const importId = randomUUID();
    const importDir = path.join(this.tempRoot, importId);
    fs.mkdirSync(importDir, { recursive: true });

    try {
      const zipBuffer = await this.downloadZipball(owner, repo);

      // adm-zip (>= 0.5.2) refuses entries that escape the target directory
      // (zip-slip), so extraction itself cannot write outside importDir.
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(importDir, true);

      // GitHub zipballs wrap everything in a single "{owner}-{repo}-{sha}/"
      // folder; use it as the root of the returned tree.
      const rootEntry = fs
        .readdirSync(importDir, { withFileTypes: true })
        .find((entry) => entry.isDirectory());
      if (!rootEntry) {
        throw new Error('Downloaded archive is empty.');
      }

      const tree: FileTreeNode = {
        name: `${owner}/${repo}`,
        type: 'directory',
        path: rootEntry.name,
        children: await this.mapDirectory(
          path.join(importDir, rootEntry.name),
          rootEntry.name,
        ),
      };

      this.logger.log(
        `Imported ${owner}/${repo} into temp/${importId} (root: ${rootEntry.name})`,
      );
      return { importId, owner, repo, tree };
    } catch (error) {
      // Leave no orphan folder behind when the import fails.
      fs.rmSync(importDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Fetches the repository zipball from the public GitHub API. Tries the
   * `main` branch first (as specified) and falls back to the repository's
   * default branch when `main` does not exist (e.g. legacy `master` repos).
   */
  private async downloadZipball(owner: string, repo: string): Promise<Buffer> {
    const base = `https://api.github.com/repos/${owner}/${repo}/zipball`;
    let response = await this.fetchZip(`${base}/main`);

    if (response.status === 404) {
      response = await this.fetchZip(base); // default branch
    }

    if (response.status === 404) {
      throw new NotFoundException(
        `Repository ${owner}/${repo} not found on GitHub (or it is private).`,
      );
    }
    if (response.status === 403 || response.status === 429) {
      throw new ServiceUnavailableException(
        'GitHub API rate limit reached. Please try again in a few minutes.',
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `GitHub API returned an unexpected status: ${response.status}`,
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private fetchZip(url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        'User-Agent': 'LinterFlow',
        Accept: 'application/vnd.github+json',
      },
      redirect: 'follow',
    });
  }

  /**
   * Recursively maps a directory into the strict FileTreeNode contract using
   * fs.promises. `relativeBase` accumulates the POSIX path relative to the
   * import root (temp/{uuid}/), which is what the frontend sends back later.
   */
  public async mapDirectory(
    absoluteDir: string,
    relativeBase: string,
  ): Promise<FileTreeNode[]> {
    const entries = await fs.promises.readdir(absoluteDir, {
      withFileTypes: true,
    });

    // Directories first, then files, both alphabetically — mirrors the
    // ordering users expect from IDE file explorers.
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const nodes: FileTreeNode[] = [];
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;

      const relativePath = path.posix.join(relativeBase, entry.name);
      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          type: 'directory',
          path: relativePath,
          children: await this.mapDirectory(
            path.join(absoluteDir, entry.name),
            relativePath,
          ),
        });
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, type: 'file', path: relativePath });
      }
    }
    return nodes;
  }

  /**
   * PATH TRAVERSAL PROTECTION
   *
   * Resolves a user-supplied relative path against temp/{importId}/ and
   * guarantees the result stays inside that sandbox:
   *
   * 1. `importId` is already constrained to a UUID by the DTO (`@IsUUID`),
   *    so it cannot contain separators or '..' segments.
   * 2. The relative path is resolved with path.resolve, which collapses any
   *    '..' / '.' segments and absolute-path tricks.
   * 3. The resolved path must equal the sandbox root or start with
   *    `${sandbox}${path.sep}` — a prefix check on the *normalized* path, so
   *    neither `../other-uuid` nor `..%2f` variants (already decoded by the
   *    framework) can escape.
   */
  public resolveSafePath(importId: string, relativePath: string): string {
    const sandbox = path.resolve(this.tempRoot, importId);
    const resolved = path.resolve(sandbox, relativePath);

    if (resolved !== sandbox && !resolved.startsWith(sandbox + path.sep)) {
      throw new BadRequestException(
        'Invalid path: it must stay inside the imported repository.',
      );
    }
    if (!fs.existsSync(sandbox)) {
      throw new NotFoundException(
        'Unknown or expired importId. Import the repository again.',
      );
    }
    if (!fs.existsSync(resolved)) {
      throw new NotFoundException(`Path not found in import: ${relativePath}`);
    }
    return resolved;
  }

  /**
   * Turns a validated selection (file or directory) into a Producer target.
   * - directory → scan every .ts file under it
   * - single .ts file → scan only that file (glob pattern = its basename)
   */
  public resolveAnalysisTarget(
    importId: string,
    relativePath: string,
  ): AnalysisTarget {
    const resolved = this.resolveSafePath(importId, relativePath);
    const stats = fs.statSync(resolved);

    if (stats.isDirectory()) {
      return { directory: resolved, pattern: '**/*.ts' };
    }
    if (!resolved.endsWith('.ts') || resolved.endsWith('.d.ts')) {
      throw new BadRequestException(
        'Only TypeScript source files (.ts) can be analyzed.',
      );
    }
    return {
      directory: path.dirname(resolved),
      pattern: path.basename(resolved),
    };
  }
}
