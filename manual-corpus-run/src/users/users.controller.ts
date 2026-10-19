import { Controller, Get, Post, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('Users')
@Controller('api/v1/users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'List/search users' })
  @ApiQuery({ name: 'search', required: false, description: 'Search term for username or full name' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  async getUsers(
    @Query('search') search?: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.usersService.findAll(currentUser?.id, search);
  }

  @ApiOperation({ summary: 'Get user profile by username' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':username')
  async getUserByUsername(
    @Param('username') username: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.usersService.findByUsername(username, currentUser?.id);
  }

  @ApiOperation({ summary: 'Follow a user' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post(':id/follow')
  async followUser(
    @Param('id') targetUserId: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.usersService.followUser(currentUser.id, targetUserId);
  }

  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Delete(':id/follow')
  async unfollowUser(
    @Param('id') targetUserId: string,
    @CurrentUser() currentUser: any,
  ) {
    return this.usersService.unfollowUser(currentUser.id, targetUserId);
  }

  @ApiOperation({ summary: 'Get followers of a user' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/followers')
  async getFollowers(
    @Param('id') userId: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.usersService.getFollowers(userId, currentUser?.id);
  }

  @ApiOperation({ summary: 'Get users followed by a user' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/following')
  async getFollowing(
    @Param('id') userId: string,
    @CurrentUser() currentUser?: any,
  ) {
    return this.usersService.getFollowing(userId, currentUser?.id);
  }
}
