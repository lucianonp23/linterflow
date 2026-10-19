import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Comments')
@Controller('api/v1')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @ApiOperation({ summary: 'Add a comment to a post' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('posts/:postId/comments')
  async createComment(
    @Param('postId') postId: string,
    @Body() createCommentDto: CreateCommentDto,
    @CurrentUser() currentUser: any,
  ) {
    return this.commentsService.create(postId, currentUser.id, createCommentDto);
  }

  @ApiOperation({ summary: 'Get comments for a post' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('posts/:postId/comments')
  async getComments(
    @Param('postId') postId: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.commentsService.findByPost(postId, currentUser?.id);
  }

  @ApiOperation({ summary: 'Delete a comment' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete('comments/:id')
  async deleteComment(
    @Param('id') commentId: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.commentsService.delete(commentId, currentUser.id);
  }
}
