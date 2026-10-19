import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'Great post! Fully agree with this.', description: 'Comment text (max 280 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(280)
  content: string;
}
