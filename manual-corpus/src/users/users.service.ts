import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like as YormLike } from 'typeorm';
import { User } from '../entities/user.entity';
import { Follow } from '../entities/follow.entity';
import { Post } from '../entities/post.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
  ) {}

  async findAll(currentUserId?: string, search?: string) {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    if (search) {
      queryBuilder.where(
        'user.username LIKE :search OR user.fullName LIKE :search',
        { search: `%${search}%` },
      );
    }

    const users = await queryBuilder.take(30).getMany();

    return Promise.all(
      users.map((u) => this.formatUserProfile(u, currentUserId)),
    );
  }

  async findByUsername(username: string, currentUserId?: string) {
    const user = await this.userRepository.findOne({ where: { username } });
    if (!user) {
      throw new NotFoundException(`User @${username} not found`);
    }
    return this.formatUserProfile(user, currentUserId);
  }

  async findById(id: string, currentUserId?: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User not found`);
    }
    return this.formatUserProfile(user, currentUserId);
  }

  async followUser(followerId: string, targetUserId: string) {
    if (followerId === targetUserId) {
      throw new BadRequestException('You cannot follow yourself');
    }

    const targetUser = await this.userRepository.findOne({ where: { id: targetUserId } });
    if (!targetUser) {
      throw new NotFoundException('User to follow does not exist');
    }

    const existingFollow = await this.followRepository.findOne({
      where: { followerId, followingId: targetUserId },
    });

    if (existingFollow) {
      return { message: 'Already following user', isFollowing: true };
    }

    const follow = this.followRepository.create({
      followerId,
      followingId: targetUserId,
    });
    await this.followRepository.save(follow);

    return { message: `Successfully followed @${targetUser.username}`, isFollowing: true };
  }

  async unfollowUser(followerId: string, targetUserId: string) {
    const follow = await this.followRepository.findOne({
      where: { followerId, followingId: targetUserId },
    });

    if (follow) {
      await this.followRepository.remove(follow);
    }

    return { message: 'Successfully unfollowed user', isFollowing: false };
  }

  async getFollowers(userId: string, currentUserId?: string) {
    const follows = await this.followRepository.find({
      where: { followingId: userId },
    });

    const followerIds = follows.map((f) => f.followerId);
    if (followerIds.length === 0) return [];

    const followers = await this.userRepository.findByIds(followerIds);
    return Promise.all(followers.map((f) => this.formatUserProfile(f, currentUserId)));
  }

  async getFollowing(userId: string, currentUserId?: string) {
    const follows = await this.followRepository.find({
      where: { followerId: userId },
    });

    const followingIds = follows.map((f) => f.followingId);
    if (followingIds.length === 0) return [];

    const following = await this.userRepository.findByIds(followingIds);
    return Promise.all(following.map((f) => this.formatUserProfile(f, currentUserId)));
  }

  private async formatUserProfile(user: User, currentUserId?: string) {
    const { passwordHash, ...safeUser } = user;

    const [followersCount, followingCount, postsCount] = await Promise.all([
      this.followRepository.count({ where: { followingId: user.id } }),
      this.followRepository.count({ where: { followerId: user.id } }),
      this.postRepository.count({ where: { authorId: user.id } }),
    ]);

    let isFollowing = false;
    if (currentUserId && currentUserId !== user.id) {
      const followRelation = await this.followRepository.findOne({
        where: { followerId: currentUserId, followingId: user.id },
      });
      isFollowing = !!followRelation;
    }

    return {
      ...safeUser,
      followersCount,
      followingCount,
      postsCount,
      isFollowing,
      isSelf: currentUserId === user.id,
    };
  }
}
