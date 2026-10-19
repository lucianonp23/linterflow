import { Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { readJsonSafe, writeJsonAtomic } from '../core/json-store';
import { MitigationReport } from '../reporter/reporter.service';
import { AuthPrincipal } from '../users/user.types';
import { FileCostEstimate } from '../credits/credits.service';

export type ReportValidationStatus = 'pending' | 'validated' | 'rejected';

export interface ReportValidation {
  status: ReportValidationStatus;
  validatedBy?: string;
  validatedAt?: string;
  notes?: string;
}

/**
 * One pipeline execution: who ran it, what it cost, and — once finished — the
 * mitigation report awaiting admin validation. Doubles as the per-user
 * history and as the admin's report-validation queue.
 */
export interface RunRecord {
  id: string;
  ownerId: string;
  ownerRole: AuthPrincipal['role'];
  /** Display label: user name/email, or "Guest" for try-on sessions. */
  ownerLabel: string;
  source: 'local' | 'github';
  target: string;
  files: FileCostEstimate[];
  creditsCharged: number;
  startedAt: string;
  finishedAt?: string;
  report?: MitigationReport;
  validation: ReportValidation;
}

/** File-backed run history (data/runs.json). */
@Injectable()
export class RunsService {
  private readonly dataDir = path.join(process.cwd(), 'data');
  private readonly filePath = path.join(this.dataDir, 'runs.json');

  private loadRuns(): RunRecord[] {
    return readJsonSafe<RunRecord[]>(this.filePath, []);
  }

  // Atomic: this file is the permanent run history, so a crash mid-write must
  // never be able to truncate it. See src/core/json-store.ts.
  private saveRuns(runs: RunRecord[]): void {
    writeJsonAtomic(this.filePath, runs);
  }

  public createRun(input: {
    principal: AuthPrincipal;
    source: RunRecord['source'];
    target: string;
    files: FileCostEstimate[];
    creditsCharged: number;
  }): RunRecord {
    const run: RunRecord = {
      id: randomUUID(),
      ownerId: input.principal.sub,
      ownerRole: input.principal.role,
      ownerLabel: input.principal.name ?? input.principal.email ?? 'Guest',
      source: input.source,
      target: input.target,
      files: input.files,
      creditsCharged: input.creditsCharged,
      startedAt: new Date().toISOString(),
      validation: { status: 'pending' },
    };
    const runs = this.loadRuns();
    runs.push(run);
    this.saveRuns(runs);
    return run;
  }

  /** Attaches the mitigation report once the background pipeline finishes. */
  public completeRun(id: string, report: MitigationReport): void {
    const runs = this.loadRuns();
    const run = runs.find((r) => r.id === id);
    if (!run) return; // The run file may have been cleaned manually; not fatal.
    run.finishedAt = new Date().toISOString();
    run.report = report;
    this.saveRuns(runs);
  }

  /** Newest-first history for one account (user or guest). */
  public listByOwner(ownerId: string): RunRecord[] {
    return this.loadRuns()
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Full history across every account — admin only. */
  public listAll(): RunRecord[] {
    return this.loadRuns().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  public findById(id: string): RunRecord | undefined {
    return this.loadRuns().find((r) => r.id === id);
  }

  /** Admin decision over a generated report. */
  public validate(
    id: string,
    adminLabel: string,
    decision: Exclude<ReportValidationStatus, 'pending'>,
    notes?: string,
  ): RunRecord {
    const runs = this.loadRuns();
    const run = runs.find((r) => r.id === id);
    if (!run) throw new NotFoundException(`Run ${id} not found.`);
    run.validation = {
      status: decision,
      validatedBy: adminLabel,
      validatedAt: new Date().toISOString(),
      notes,
    };
    this.saveRuns(runs);
    return run;
  }
}
