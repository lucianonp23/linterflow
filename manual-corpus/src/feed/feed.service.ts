import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Post } from '../entities/post.entity';
import { Follow } from '../entities/follow.entity';
import { PostsService } from '../posts/posts.service';

@Injectable()
export class FeedService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    private readonly postsService: PostsService,
  ) {}

  async getTimelineFeed(currentUserId: string, page = 1, limit = 20) {
    const follows = await this.followRepository.find({
      where: { followerId: currentUserId },
    });

    const followedUserIds = follows.map((f) => f.followingId);
    // Include user's own posts in their timeline feed
    const authorIds = [...followedUserIds, currentUserId];

    const [posts, total] = await this.postRepository.findAndCount({
      where: { authorId: In(authorIds) },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const formattedPosts = await Promise.all(
      posts.map((p) => this.postsService.formatPost(p, currentUserId)),
    );

    return {
      data: formattedPosts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getExploreFeed(currentUserId?: string, page = 1, limit = 20) {
    const [posts, total] = await this.postRepository.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const formattedPosts = await Promise.all(
      posts.map((p) => this.postsService.formatPost(p, currentUserId)),
    );

    return {
      data: formattedPosts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
