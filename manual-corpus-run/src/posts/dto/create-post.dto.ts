import { IsString, MaxLength, MinLength, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePostDto {
  @ApiProperty({ example: 'Hello world! Excited to share my first post on this network! 🚀', description: 'Post content (max 280 chars)' })
  @IsString()
  @MinLength(1)
  @MaxLength(280)
  content: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600', required: false, description: 'Optional image attachment URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
