import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import {
  PIPELINE_IGNORE,
  JSCPD_MIN_LINES,
  JSCPD_MIN_TOKENS,
} from '../core/pipeline-files';
import {
  DuplicationComparison,
  FilePairStat,
  ProjectDuplicationResult,
} from './duplication.types';

// Same `require` style the EvaluatorService uses — jscpd has no usable named
// export under this TS config.
const { detectClones } = require('jscpd');

/**
 * Measures duplication across a WHOLE FOLDER, which the pipeline cannot do.
 *
 * `ProducerService.analyzeFile()` calls `detectDuplications(filePath)` with a
 * single path, so jscpd only ever compares a file against itself. That is right
 * for the gate — attributing a folder-wide clone to one file would falsify that
 * file's pre/post delta — but it means repetition BETWEEN files is invisible.
 * Two near-identical services register 0% each.
 *
 * This service answers the other question, and deliberately does not touch the
 * pipeline: it is additive and read-only, so the corpus results already measured
 * stay comparable with the code that produced them.
 *
 * HOW THE RATE DIFFERS FROM THE PER-FILE ONE
 * ------------------------------------------
 * `EvaluatorService.calculateDuplicationRate()` sums every clone fragment and
 * divides by the file's line count, counting only side A and double-counting
 * overlaps (hence its clamp to 100%).
 *
 * Here both sides are attributed to their own file and each file keeps a SET of
 * duplicated line numbers, so a line in five clones counts once and the result
 * is bounded by 100% without clamping. The two numbers are NOT interchangeable.
 */
@Injectable()
export class DuplicationService {
  private readonly logger = new Logger(DuplicationService.name);

  /** Rounds to 3 decimals, matching the precision the Reporter uses. */
  private round(value: number, dp = 3): number {
    const factor = 10 ** dp;
    return Math.round(value * factor) / factor;
  }

  /** Line count, computed exactly like the per-file rate does. */
  private countLines(source: string): number {
    return source.split('\n').length;
  }

  public async measureProject(
    directory: string,
    top = 10,
  ): Promise<ProjectDuplicationResult> {
    const absoluteDir = path.resolve(process.cwd(), directory);
    if (!fs.existsSync(absoluteDir)) {
      throw new Error(`Directory not found: ${directory}`);
    }
    if (!fs.statSync(absoluteDir).isDirectory()) {
      throw new Error(`Not a directory: ${directory}`);
    }

    const files = await glob('**/*.ts', {
      cwd: absoluteDir,
      absolute: true,
      ignore: PIPELINE_IGNORE,
    });

    if (files.length === 0) {
      throw new Error(
        `No .ts files under ${directory} (after the pipeline's ignore rules).`,
      );
    }

    const linesByFile = new Map<string, number>();
    let totalLines = 0;
    for (const file of files) {
      const count = this.countLines(fs.readFileSync(file, 'utf-8'));
      linesByFile.set(path.resolve(file), count);
      totalLines += count;
    }

    this.logger.log(
      `Scanning ${files.length} file(s) in ${absoluteDir} for duplication.`,
    );

    const clones = await detectClones({
      path: [absoluteDir],
      pattern: '**/*.ts',
      blame: false,
      silent: true,
      minLines: JSCPD_MIN_LINES,
      minTokens: JSCPD_MIN_TOKENS,
      gitignore: false,
      // The EvaluatorService passes `ignore: []` because it scans ONE file,
      // where there is nothing to exclude. A generated application carries its
      // own node_modules; without this, jscpd would report the dependencies'
      // clones as the application's duplication.
      ignore: PIPELINE_IGNORE,
    });

    const duplicatedLinesByFile = new Map<string, Set<number>>();
    const pairs = new Map<string, FilePairStat>();

    for (const clone of clones) {
      const sides = [clone.duplicationA, clone.duplicationB];
      const involved: string[] = [];

      for (const side of sides) {
        const file = path.resolve(side.sourceId);
        involved.push(file);
        // jscpd can surface paths the glob excluded. Only attribute lines to
        // files that are actually in scope.
        if (!linesByFile.has(file)) continue;

        let marked = duplicatedLinesByFile.get(file);
        if (!marked) {
          marked = new Set<number>();
          duplicatedLinesByFile.set(file, marked);
        }
        for (let line = side.start.line; line <= side.end.line; line++) {
          marked.add(line);
        }
      }

      const [a, b] = involved.map((f) => path.relative(absoluteDir, f)).sort();
      const key = `${a} ${b}`;
      const span = clone.duplicationA.end.line - clone.duplicationA.start.line + 1;
      const existing = pairs.get(key);
      if (existing) {
        existing.clones += 1;
        existing.lines += span;
      } else {
        pairs.set(key, { files: [a, b], clones: 1, lines: span });
      }
    }

    let duplicatedLines = 0;
    const worstFiles: ProjectDuplicationResult['worstFiles'] = [];
    for (const [file, marked] of duplicatedLinesByFile) {
      duplicatedLines += marked.size;
      const fileLines = linesByFile.get(file) ?? 0;
      worstFiles.push({
        file: path.relative(absoluteDir, file),
        duplicatedLines: marked.size,
        totalLines: fileLines,
        rate: fileLines ? this.round((marked.size / fileLines) * 100) : 0,
      });
    }
    worstFiles.sort((x, y) => y.duplicatedLines - x.duplicatedLines);

    const topFilePairs = [...pairs.values()]
      .sort((x, y) => y.lines - x.lines)
      .slice(0, top);

    return {
      directory: absoluteDir,
      filesScanned: files.length,
      totalLines,
      clonePairs: clones.length,
      duplicatedLines,
      duplicationRate: totalLines
        ? this.round((duplicatedLines / totalLines) * 100)
        : 0,
      worstFiles: worstFiles.slice(0, top),
      topFilePairs,
      thresholds: { minLines: JSCPD_MIN_LINES, minTokens: JSCPD_MIN_TOKENS },
    };
  }

  /**
   * Measures two folders and the movement between them.
   *
   * Note for whoever reports this: the pipeline never TRIES to reduce
   * duplication between files, because it cannot see it. Movement here is a
   * side effect of the CC/MI refactoring, not evidence of duplication being
   * mitigated. Clones inside a single file are the exception — those the
   * per-file gate does see and does act on.
   */
  public async compare(
    beforeDirectory: string,
    afterDirectory: string,
    top = 10,
  ): Promise<DuplicationComparison> {
    const before = await this.measureProject(beforeDirectory, top);
    const after = await this.measureProject(afterDirectory, top);

    return {
      before,
      after,
      delta: {
        filesScanned: after.filesScanned - before.filesScanned,
        totalLines: after.totalLines - before.totalLines,
        clonePairs: after.clonePairs - before.clonePairs,
        duplicatedLines: after.duplicatedLines - before.duplicatedLines,
        duplicationRate: this.round(
          after.duplicationRate - before.duplicationRate,
        ),
      },
    };
  }
}
