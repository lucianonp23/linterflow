import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { GithubService } from './github.service';
import { ImportRepoDto } from './dto/import-repo.dto';
import { AnalyzeImportDto } from './dto/analyze-import.dto';
import { ProducerService } from '../producer/producer.service';
import { ReporterService } from '../reporter/reporter.service';
import { PipelineBillingService } from '../credits/pipeline-billing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../users/user.types';

@ApiTags('github')
@ApiBearerAuth()
@Controller('api/github')
@UseGuards(JwtAuthGuard)
export class GithubController {
  private readonly logger = new Logger(GithubController.name);

  constructor(
    private readonly githubService: GithubService,
    private readonly producerService: ProducerService,
    private readonly reporterService: ReporterService,
    private readonly billingService: PipelineBillingService,
  ) {}

  /**
   * POST /api/github/import
   * Downloads a public GitHub repository and returns its file tree.
   */
  @Post('import')
  @ApiOperation({
    summary: 'Import a public GitHub repository',
    description:
      'Downloads the repository zipball, extracts it into an isolated temp/{uuid}/ directory and returns the mapped file tree so the user can pick what to analyze.',
  })
  @ApiCreatedResponse({
    description: 'Repository imported; response contains importId and tree.',
  })
  public async importRepository(@Body() dto: ImportRepoDto) {
    const ref = ImportRepoDto.parseGithubUrl(dto.repoUrl);
    if (!ref) {
      // Unreachable in practice (the DTO regex already validated the URL),
      // kept as a guard for direct service reuse.
      throw new BadRequestException('Invalid GitHub repository URL.');
    }

    this.logger.log(`Importing GitHub repository ${ref.owner}/${ref.repo}`);
    return this.githubService.importRepository(ref);
  }

  /**
   * POST /api/github/analyze
   * Prices and charges the selected path, then runs the pipeline over it.
   */
  @Post('analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Analyze a path inside an imported repository',
    description:
      'Validates the selected path against the import sandbox (Path-Traversal safe), charges the run cost in credits and starts the self-healing pipeline over it in the background. Directories are scanned recursively; a single .ts file is analyzed alone. Fails with 402 when the account balance does not cover the cost.',
  })
  @ApiAcceptedResponse({
    description: 'Analysis accepted and started in the background.',
  })
  public async startAnalysis(
    @Body() dto: AnalyzeImportDto,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    const target = this.githubService.resolveAnalysisTarget(
      dto.importId,
      dto.path,
    );

    // Charge upfront over the exact file set the pipeline will process.
    const authorized = await this.billingService.authorizeRun(
      principal,
      'github',
      dto.path,
      target.directory,
      target.pattern,
    );

    this.logger.log(
      `Starting analysis of import ${dto.importId} → ${dto.path} (pattern: ${target.pattern})`,
    );

    // Same fire-and-forget pattern as the orchestrator controller: the
    // pipeline may take minutes, so the HTTP request must not wait for it.
    this.producerService
      .orchestrateFolder(target.directory, target.pattern)
      .then(() =>
        this.billingService.completeRun(
          authorized.run.id,
          this.reporterService.generateReport(),
        ),
      )
      .catch((error) => {
        this.logger.error(
          `Critical failure in background analysis: ${error.message}`,
        );
      });

    return {
      status: 'PROCESSING',
      message: 'Analysis started successfully in the background.',
      importId: dto.importId,
      targetDirectory: dto.path,
      timestamp: new Date().toISOString(),
      runId: authorized.run.id,
      filesFound: authorized.estimate.files.length,
      creditsCharged: authorized.creditsCharged,
      creditsRemaining: authorized.creditsRemaining,
    };
  }
}
