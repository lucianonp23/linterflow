import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { FeedService } from './feed.service';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Feed')
@Controller('api/v1/feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @ApiOperation({ summary: 'Get personalized timeline feed (posts from followed users)' })
  @ApiBearerAuth()
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @UseGuards(JwtAuthGuard)
  @Get()
  async getTimelineFeed(
    @CurrentUser() currentUser: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.feedService.getTimelineFeed(currentUser.id, Number(page), Number(limit));
  }

  @ApiOperation({ summary: 'Get global explore feed (all recent posts)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('explore')
  async getExploreFeed(
    @CurrentUser() currentUser?: any,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.feedService.getExploreFeed(currentUser?.id, Number(page), Number(limit));
  }
}
