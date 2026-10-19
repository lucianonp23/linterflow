import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class OrchestrateDto {
  /**
   * The absolute or relative path to the directory containing the source code.
   */
  @ApiProperty({
    description: 'Absolute or relative path to the directory containing the .ts files to refactor.',
    example: './mock-code',
  })
  @IsString()
  @IsNotEmpty()
  targetDirectory: string;
}