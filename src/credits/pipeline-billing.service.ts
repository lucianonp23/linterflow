import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { CreditsService, RunCostEstimate } from './credits.service';
import { InsufficientCreditsError, UsersService } from '../users/users.service';
import { RunsService, RunRecord } from '../runs/runs.service';
import { MitigationReport } from '../reporter/reporter.service';
import { AuthPrincipal } from '../users/user.types';

export interface AuthorizedRun {
  run: RunRecord;
  estimate: RunCostEstimate;
  creditsCharged: number;
  /** null for admins (unlimited). */
  creditsRemaining: number | null;
}

/**
 * Shared pre-flight for every pipeline entry point (local path and GitHub
 * import): price the run, charge the account upfront and open the history
 * record. Charging happens before the pipeline starts so a run can never
 * exceed the account's balance mid-flight.
 */
@Injectable()
export class PipelineBillingService {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly usersService: UsersService,
    private readonly runsService: RunsService,
  ) {}

  public async authorizeRun(
    principal: AuthPrincipal,
    source: RunRecord['source'],
    targetLabel: string,
    directory: string,
    filePattern = '**/*.ts',
  ): Promise<AuthorizedRun> {
    const estimate = await this.creditsService.estimateRun(directory, filePattern);
    if (estimate.files.length === 0) {
      throw new BadRequestException(
        'No analyzable TypeScript files found in the selected target.',
      );
    }

    let charge: { charged: number; remaining: number | null };
    try {
      charge = this.usersService.charge(principal, estimate.totalCost);
    } catch (error) {
      if (error instanceof InsufficientCreditsError) {
        // 402 lets the frontend distinguish "no credits" from other failures.
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            message: error.message,
            required: error.required,
            available: error.available,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw error;
    }

    const run = this.runsService.createRun({
      principal,
      source,
      target: targetLabel,
      files: estimate.files,
      creditsCharged: charge.charged,
    });

    return {
      run,
      estimate,
      creditsCharged: charge.charged,
      creditsRemaining: charge.remaining,
    };
  }

  /** Stores the finished report on the run's history/validation record. */
  public completeRun(runId: string, report: MitigationReport): void {
    this.runsService.completeRun(runId, report);
  }
}
