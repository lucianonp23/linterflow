import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
import { GithubService } from './github.service';

/** Imports older than this are considered abandoned and are deleted. */
const MAX_IMPORT_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/**
 * Housekeeping for the temp/ import area.
 *
 * WHY A CRON JOB? (requested validation)
 * The NestJS server is long-running and each GitHub import extracts a full
 * repository into temp/{uuid}/ with no natural deletion point — the user may
 * keep browsing the tree or trigger several analyses over it. Without a
 * scheduled sweep the folder grows without bound. A daily cron (via
 * @nestjs/schedule) is the simplest fit; alternatives were considered:
 *   - delete right after analysis → breaks re-analysis of another path of
 *     the same import;
 *   - cleanup only on boot → never runs on a server that stays up for weeks.
 * The job therefore runs daily at 03:00 AND once at startup (covers servers
 * that were down when the cron would have fired).
 */
@Injectable()
export class GithubCleanupService implements OnModuleInit {
  private readonly logger = new Logger(GithubCleanupService.name);

  constructor(private readonly githubService: GithubService) {}

  onModuleInit(): void {
    this.cleanupOldImports();
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  public cleanupOldImports(): void {
    const tempRoot = this.githubService.tempRoot;
    if (!fs.existsSync(tempRoot)) return;

    const now = Date.now();
    let removed = 0;

    for (const entry of fs.readdirSync(tempRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const importDir = path.join(tempRoot, entry.name);

      try {
        const stats = fs.statSync(importDir);
        if (now - stats.mtimeMs > MAX_IMPORT_AGE_MS) {
          fs.rmSync(importDir, { recursive: true, force: true });
          removed++;
        }
      } catch (error: any) {
        this.logger.warn(
          `Could not clean up ${importDir}: ${error.message}`,
        );
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleanup removed ${removed} expired import(s) from temp/`);
    }
  }
}
