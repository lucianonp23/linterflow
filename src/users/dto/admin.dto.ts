import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ApproveUserDto {
  @ApiProperty({
    example: 10,
    description: 'Initial credit allowance granted to the approved user.',
  })
  @IsInt()
  @Min(0)
  credits: number;
}

export class UpdateCreditsDto {
  @ApiProperty({ example: 5, description: 'New remaining credit balance.' })
  @IsInt()
  @Min(0)
  credits: number;
}

export class UpdateSettingsDto {
  @ApiProperty({
    example: 3,
    description: 'Credits granted to each new guest (try-on) session.',
  })
  @IsInt()
  @Min(0)
  guestCreditLimit: number;
}

export class ValidateReportDto {
  @ApiProperty({ enum: ['validated', 'rejected'] })
  @IsIn(['validated', 'rejected'])
  decision: 'validated' | 'rejected';

  @ApiPropertyOptional({ example: 'Metrics look consistent with the corpus.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
