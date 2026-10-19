import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeImportDto {
  @ApiProperty({
    description: 'Import identifier returned by POST /api/github/import.',
    example: 'e4c8f6a2-1234-4b5c-9d0e-abcdef012345',
  })
  // Enforcing the UUID format is the first Path-Traversal barrier: an
  // attacker cannot smuggle separators or '..' segments inside the id itself.
  @IsUUID('4')
  importId: string;

  @ApiProperty({
    description:
      'Path (relative to the import root) of the file or directory to analyze.',
    example: 'nestjs-typescript-starter-abc1234/src',
  })
  @IsString()
  @IsNotEmpty()
  path: string;
}
