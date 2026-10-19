import { Injectable, Logger } from '@nestjs/common';
import { parse, ParseResult } from '@babel/parser';
import { File } from '@babel/types';
import {
  FileMetrics,
  DuplicationIssue,
  MAX_CYCLOMATIC_COMPLEXITY,
} from '../core/types';

//Require takes the full package module not only the exported functions
const escomplexModule = require('typhonjs-escomplex');
const escomplex = escomplexModule.default || escomplexModule; 
const { detectClones } = require('jscpd');

/**
 * Babel parser configuration, shared by BOTH parsing stages.
 *
 * `decorators-legacy` is what allows the standard NestJS idiom:
 *
 *     @Controller('bookmarks')
 *     export class BookmarksController {}
 *
 * It MUST be passed to escomplex as well. Left to its own defaults, escomplex
 * enables every Babel plugin at once, which turns on the modern `decorators`
 * plugin with `decoratorsBeforeExport: false` — and that rejects decorators
 * placed before `export`, i.e. essentially every NestJS controller, service
 * and module in existence. The failure surfaced as
 * "Complexity analysis error: Decorators must be placed *after* the 'export'
 * keyword", with generateAST() happily parsing the very same file.
 *
 * Keep the two stages on one constant: if they diverge, a file can parse in
 * one stage and throw in the other.
 */
const BABEL_PARSER_OPTIONS = {
  sourceType: 'module' as const,
  plugins: ['typescript', 'decorators-legacy', 'jsx'] as any[],
};

@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger(EvaluatorService.name);

  public generateAST(sourceCode: string): ParseResult<File> {
    try {
      return parse(sourceCode, BABEL_PARSER_OPTIONS);
    } catch (error: any) {
      throw new Error(`Static analysis error: ${error.message}`);
    }
  }

  /**
   * Rewrites `constructor(private readonly x: T)` into `constructor(x: T)`.
   *
   * TypeScript parameter properties parse to `TSParameterProperty`, a node
   * escomplex's code generator has never heard of, and it fails the whole file
   * with "state.generator[node.type] is not a function". That idiom is how
   * every NestJS service and controller declares its dependencies, so without
   * this the analyser silently cannot measure ordinary NestJS code — twelve of
   * the thirty-one files in the manual corpus, all of them the services and
   * controllers, and none of the sixty single-file corpus entries, which are
   * self-contained and inject nothing. The synthetic corpus never exposed it.
   *
   * Unwrapping to the inner parameter is safe for these metrics: a parameter
   * property is a parameter plus an implicit field assignment, and neither adds
   * a decision point. Arity is unchanged because one node is swapped for one
   * node. Files with no such node come through byte-identical, which is what
   * keeps the already-measured corpus results comparable.
   */
  private unwrapParameterProperties(node: any): void {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i]?.type === 'TSParameterProperty') {
            value[i] = value[i].parameter;
          }
          this.unwrapParameterProperties(value[i]);
        }
      } else if (value && typeof value === 'object') {
        if (value.type === 'TSParameterProperty') {
          node[key] = value.parameter;
        }
        this.unwrapParameterProperties(node[key]);
      }
    }
  }

  public analyzeMetrics(sourceCode: string): FileMetrics {
    try {
      // Parsed here rather than letting escomplex do it, so the AST can be
      // repaired before analysis. BABEL_PARSER_OPTIONS is the same set that was
      // previously passed as the 3rd argument: without it escomplex parses with
      // all plugins enabled and chokes on `@Decorator export class`.
      const ast = parse(sourceCode, BABEL_PARSER_OPTIONS);
      this.unwrapParameterProperties(ast);
      const report = escomplex.analyzeModuleAST(ast);
      const functions = this.collectFunctions(report);

      // A file with no functions at all (e.g. a DTO that is only decorated
      // fields) has nothing to take a maximum over. Fall back to the module
      // aggregate, which for such a file is the top-level code's complexity.
      if (functions.length === 0) {
        const aggregate = report.aggregate.cyclomatic;
        const overThreshold = aggregate > MAX_CYCLOMATIC_COMPLEXITY;
        return {
          cyclomaticComplexity: aggregate,
          maintainabilityIndex: report.maintainability,
          cyclomaticViolations: overThreshold ? 1 : 0,
          totalCyclomaticComplexity: aggregate,
          functionCount: 0,
          violatingFunctions: overThreshold
            ? [{ name: '(module top-level code)', cyclomaticComplexity: aggregate }]
            : [],
        };
      }

      const complexities = functions.map((fn) => fn.cyclomatic);
      const violating = functions
        .filter((fn) => fn.cyclomatic > MAX_CYCLOMATIC_COMPLEXITY)
        .map((fn) => ({
          name: fn.name ?? '(unnamed)',
          cyclomaticComplexity: fn.cyclomatic,
        }))
        .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);

      return {
        cyclomaticComplexity: Math.max(...complexities),
        maintainabilityIndex: report.maintainability,
        cyclomaticViolations: violating.length,
        totalCyclomaticComplexity: complexities.reduce((sum, cc) => sum + cc, 0),
        functionCount: complexities.length,
        violatingFunctions: violating,
      };
    } catch (error: any) {
      throw new Error(`Complexity analysis error: ${error.message}`);
    }
  }

  /**
   * Every function escomplex found, from both places it hides them.
   *
   * Standalone functions land in `report.methods`; class methods land in
   * `report.classes[].methods`. Neither list is enough on its own — a NestJS
   * controller populates only the second, a DTO/validator module only the
   * first — so anything reading one without the other silently sees half the
   * file.
   */
  private collectFunctions(report: any): Array<{ name?: string; cyclomatic: number }> {
    return [
      ...(report.methods ?? []),
      ...(report.classes ?? []).flatMap((cls: any) => cls.methods ?? []),
    ];
  }

  /**
   * Names of everything the module exports.
   *
   * This is the file's public contract, and the acceptance guard uses it to
   * reject a "refactoring" that simply deletes code. Metrics alone cannot tell
   * the two apart: gutting a controller down to an empty class takes its CC
   * violations to zero and its Maintainability Index up, so on every dimension
   * the guard compares, deletion looks like the best possible result.
   *
   * Preserving the exported names does not prove behaviour was preserved — only
   * a test suite would — but it closes the crude failure mode, which is the one
   * that actually occurs.
   */
  public extractExportedSymbols(sourceCode: string): string[] {
    const ast = this.generateAST(sourceCode);
    const names = new Set<string>();

    for (const node of ast.program.body as any[]) {
      if (node.type === 'ExportDefaultDeclaration') {
        names.add('default');
        continue;
      }
      if (node.type === 'ExportAllDeclaration') {
        names.add(`*from:${node.source?.value ?? '?'}`);
        continue;
      }
      if (node.type !== 'ExportNamedDeclaration') continue;

      // export { a, b as c }
      for (const spec of node.specifiers ?? []) {
        const exported = spec.exported;
        if (exported) names.add(exported.name ?? exported.value);
      }

      // export class X / function X / interface X / type X / enum X
      const declaration = node.declaration;
      if (!declaration) continue;
      if (declaration.id?.name) names.add(declaration.id.name);

      // export const a = 1, b = 2
      for (const declarator of declaration.declarations ?? []) {
        if (declarator.id?.type === 'Identifier') names.add(declarator.id.name);
      }
    }

    return [...names].sort();
  }

  /**
   * Scans a directory or file for copied and pasted code blocks (DRY violations).
   * @param targetPath The path of the folder or file to analyze.
   * @returns A list of detected DRY violations.
   */
  public async detectDuplications(targetPath: string): Promise<DuplicationIssue[]> {
    try {
      this.logger.log(`Scanning for duplications (DRY) in: ${targetPath}`);

      // Execute jscpd programmatically with the options-based API
      const clones = await detectClones({
        path: [targetPath], // Where it should look
        pattern: '**/*.ts', //filter only typescript files
        blame: false,
        silent: true, // Prevents jscpd from polluting our terminal logs
        minLines: 5, // Only considers a copy if 5 or more lines match
        minTokens: 50, // Prevents false positives on very short statements
        gitignore: false,
        ignore: [],
               
      });

      // Map the huge jscpd return object to our simple contract
      const duplications: DuplicationIssue[] = clones.map((clone: any) => ({
        lines: `${clone.duplicationA.start.line}-${clone.duplicationA.end.line}`,
        fragment: clone.duplicationA.fragment,
      }));

      this.logger.log(`Found ${duplications.length} duplicated code block(s).`);
      return duplications;

    } catch (error: any) {
      this.logger.error(`Failed to detect duplications: ${error.message}`);
      return []; // Return empty array on failure to avoid breaking the pipeline
    }
  }

  /**
   * Calculates the duplication rate of a file as a percentage.
   * Rate = (duplicated lines / total lines) * 100
   * @param duplications The DRY violations detected by detectDuplications().
   * @param sourceCode The full source code of the analysed file.
   * @returns The duplication rate as a percentage (0–100).
   */
  public calculateDuplicationRate(
    duplications: DuplicationIssue[],
    sourceCode: string,
  ): number {
    const totalLines = sourceCode.split('\n').length;
    if (totalLines === 0) return 0;

    // Sum the size (in lines) of each duplicated fragment. The `lines` field is
    // formatted as "start-end" by detectDuplications().
    const duplicatedLines = duplications.reduce((sum, dup) => {
      const [start, end] = dup.lines.split('-').map((n) => parseInt(n, 10));
      if (Number.isNaN(start) || Number.isNaN(end)) return sum;
      return sum + (end - start + 1);
    }, 0);

    const rate = (duplicatedLines / totalLines) * 100;
    // Clamp to 100% to guard against overlapping clones being double-counted.
    return Math.min(rate, 100);
  }
}