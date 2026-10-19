import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AppEnvironment = 'staging' | 'production';

/**
 * Which environment this instance is running as, and what that permits.
 *
 * The only capability it currently gates is analysis by LOCAL PATH. In
 * `staging` the operator may point the pipeline at any folder on the machine,
 * which is what the dissertation's experiments need. In `production` that is
 * refused and only the GitHub import route is available.
 *
 * WHY LOCAL PATHS CANNOT BE PUBLIC
 * --------------------------------
 * `OrchestrateDto.targetDirectory` is an unrestricted path, and the pipeline
 * does not merely read it: it sends every file's contents to Gemini and writes
 * the model's answer back over the original. Exposed, that is remote arbitrary
 * file read and write. The GitHub route has neither property — it downloads
 * into `temp/{uuid}/` and `GithubService.resolveSafePath()` refuses anything
 * that resolves outside that sandbox.
 *
 * DEFAULTS TO THE RESTRICTIVE VALUE, ON PURPOSE
 * ---------------------------------------------
 * Only the exact string `staging` unlocks local paths. Anything else —
 * unset, misspelt, empty — is treated as production. This mirrors
 * `CREDITS_ENABLED`, where only the exact string `"false"` disables billing so
 * that a configuration slip cannot make the pipeline free. Here the same shape
 * means a configuration slip cannot expose the filesystem: forgetting the
 * variable costs you a local run, not a breach.
 */
@Injectable()
export class AppEnvironmentService {
  private readonly logger = new Logger(AppEnvironmentService.name);
  private readonly environment: AppEnvironment;

  constructor(private readonly config: ConfigService) {
    const raw = (this.config.get<string>('APP_ENV') ?? '').trim().toLowerCase();
    this.environment = raw === 'staging' ? 'staging' : 'production';

    if (this.environment === 'staging') {
      this.logger.warn(
        'APP_ENV=staging — analysis by local path is ENABLED. Never run this way on a reachable host: the pipeline rewrites the files it is pointed at.',
      );
    } else {
      this.logger.log(
        `APP_ENV=${raw || '(unset)'} — running as production. Only GitHub import analysis is allowed; local paths are refused.`,
      );
    }
  }

  public get current(): AppEnvironment {
    return this.environment;
  }

  public isProduction(): boolean {
    return this.environment === 'production';
  }

  /** True when the pipeline may be pointed at a folder on this machine. */
  public isLocalPathAnalysisEnabled(): boolean {
    return this.environment === 'staging';
  }

  /**
   * Throws 403 unless local-path analysis is permitted.
   *
   * A refusal is a policy decision, not a missing resource or a bad request:
   * the route exists and the payload is valid, but this deployment will not
   * serve it. 403 says that; 404 would hide it and 400 would suggest the
   * caller could fix the input.
   */
  public assertLocalPathAnalysisAllowed(): void {
    if (this.isLocalPathAnalysisEnabled()) return;
    throw new ForbiddenException(
      'Analysis by local path is disabled in production. Import a public GitHub repository instead.',
    );
  }
}
