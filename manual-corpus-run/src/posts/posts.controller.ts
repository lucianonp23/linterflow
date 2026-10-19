import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PostsService } from './posts.service';
import { CreatePostDto } from './dto/create-post.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Posts')
@Controller('api/v1/posts')
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @ApiOperation({ summary: 'Create a short post' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post()
  async createPost(
    @Body() createPostDto: CreatePostDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.postsService.create(currentUser.id, createPostDto);
  }

  @ApiOperation({ summary: 'Get post details by ID' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getPost(
    @Param('id') id: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.postsService.findOne(id, currentUser?.id);
  }

  @ApiOperation({ summary: 'Delete a post' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async deletePost(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.postsService.delete(id, currentUser.id);
  }

  @ApiOperation({ summary: 'Like a post' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/like')
  async likePost(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.postsService.likePost(id, currentUser.id);
  }

  @ApiOperation({ summary: 'Unlike a post' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/like')
  async unlikePost(
    @Param('id') id: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.postsService.unlikePost(id, currentUser.id);
  }

  @ApiOperation({ summary: 'Get posts published by a user' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('user/:userId')
  async getUserPosts(
    @Param('userId') userId: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.postsService.getUserPosts(userId, currentUser?.id);
  }
}
