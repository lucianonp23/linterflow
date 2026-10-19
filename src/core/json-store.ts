import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Crash-safe helpers for the file-backed JSON stores (data/runs.json,
 * users.json, guests.json, settings.json).
 *
 * Why this exists: fs.writeFileSync truncates the target before writing it. A
 * process that dies mid-write — Ctrl-C during a pipeline run, a crash, a full
 * disk — leaves a half-written file behind, and every subsequent JSON.parse of
 * it throws. For a store that doubles as the permanent run history, that turns
 * one bad moment into total data loss.
 */
const logger = new Logger('JsonStore');

/**
 * Writes JSON atomically: the data lands in a sibling temp file first, then a
 * rename swaps it into place. rename(2) is atomic on POSIX, so a reader either
 * sees the whole previous version or the whole new one — never a torn file.
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  // Same directory as the target: rename is only atomic within one filesystem.
  const tempPath = `${filePath}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    // Never leave the temp file behind to be mistaken for real data.
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* the original error below is the one worth reporting */
      }
    }
    throw error;
  }
}

/**
 * Reads a JSON store, tolerating a corrupt file instead of wedging the app.
 *
 * A file that fails to parse is preserved as `<name>.corrupt-<timestamp>` and
 * the caller gets the fallback, so the application keeps working and the bad
 * data stays on disk for manual recovery. This is logged at error level: it
 * should never pass unnoticed.
 */
export function readJsonSafe<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;

  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch (error: any) {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantinePath);
    } catch {
      /* if even the rename fails there is nothing more we can do here */
    }

    logger.error(
      `Corrupt JSON store at ${filePath} (${error.message}). ` +
        `The unreadable file was preserved as ${quarantinePath} and the store ` +
        `restarted empty. Recover it by hand before trusting the history again.`,
    );
    return fallback;
  }
}
