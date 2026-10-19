import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { DuplicationService } from './duplication.service';
import { MeasureDuplicationDto } from './dto/measure-duplication.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('duplication')
@ApiBearerAuth()
@Controller('api/duplication')
@UseGuards(JwtAuthGuard)
export class DuplicationController {
  private readonly logger = new Logger(DuplicationController.name);

  constructor(private readonly duplicationService: DuplicationService) {}

  /**
   * POST /api/duplication/measure
   *
   * Synchronous, unlike `/api/orchestrator/start`: this makes no LLM calls and
   * finishes in seconds, so there is no run to track and nothing to bill.
   * Deliberately NOT charged in credits — pricing a read-only measurement would
   * discourage taking the "before" snapshot, which is the one that cannot be
   * recovered once the pipeline has rewritten the code.
   */
  @Post('measure')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Measure duplication across a whole folder',
    description:
      "Scans every .ts file in the folder against every other, which the pipeline cannot do — it compares each file only against itself. Pass compareWith to measure a second folder and get the deltas. Free: no LLM calls, no credits. Note the rate is NOT the same measurement as the per-file duplicationRate in the mitigation report.",
  })
  @ApiOkResponse({
    description: 'Duplication measured.',
    schema: {
      example: {
        mode: 'single',
        result: {
          directory: '/…/manual-corpus-run',
          filesScanned: 31,
          totalLines: 1535,
          clonePairs: 2,
          duplicatedLines: 63,
          duplicationRate: 4.104,
          worstFiles: [
            {
              file: 'src/feed/feed.service.ts',
              duplicatedLines: 41,
              totalLines: 71,
              rate: 57.746,
            },
          ],
          topFilePairs: [
            {
              files: ['src/feed/feed.service.ts', 'src/feed/feed.service.ts'],
              clones: 1,
              lines: 20,
            },
          ],
          thresholds: { minLines: 5, minTokens: 50 },
        },
      },
    },
  })
  async measure(@Body() dto: MeasureDuplicationDto) {
    try {
      if (dto.compareWith) {
        const comparison = await this.duplicationService.compare(
          dto.compareWith,
          dto.targetDirectory,
          dto.top,
        );
        return { mode: 'comparison', ...comparison };
      }

      const result = await this.duplicationService.measureProject(
        dto.targetDirectory,
        dto.top,
      );
      return { mode: 'single', result };
    } catch (error: any) {
      // A missing folder or one with no TypeScript in it is the caller's
      // mistake, not a server fault — surface it as a 400 with the reason
      // rather than a 500 the UI can only render as "something went wrong".
      this.logger.warn(`Duplication measurement failed: ${error.message}`);
      throw new BadRequestException(error.message);
    }
  }
}
