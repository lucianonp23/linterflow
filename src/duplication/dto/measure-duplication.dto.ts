import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Measure one folder, or two when `compareWith` is present.
 *
 * Paths are local and arbitrary, exactly like `OrchestrateDto.targetDirectory`:
 * the pipeline is a research instrument pointed at folders on the operator's
 * own machine. The route is behind `JwtAuthGuard` for the same reason that one
 * is — this DTO does not widen the existing threat model, and this endpoint is
 * strictly read-only where the orchestrator writes.
 */
export class MeasureDuplicationDto {
  @ApiProperty({
    description: 'Folder to scan for duplication.',
    example: './manual-corpus-run',
  })
  @IsString()
  @IsNotEmpty()
  targetDirectory!: string;

  @ApiPropertyOptional({
    description:
      'When given, both folders are measured and the deltas returned. Pass the pre-mitigation copy here and the refactored one in targetDirectory.',
    example: './manual-corpus',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  compareWith?: string;

  @ApiPropertyOptional({
    description: 'How many file pairs and worst files to list.',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  top?: number;
}
