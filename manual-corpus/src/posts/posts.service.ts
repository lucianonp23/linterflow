import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '../entities/post.entity';
import { User } from '../entities/user.entity';
import { Like } from '../entities/like.entity';
import { CreatePostDto } from './dto/create-post.dto';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Like)
    private readonly likeRepository: Repository<Like>,
  ) {}

  async create(authorId: string, createPostDto: CreatePostDto) {
    const post = this.postRepository.create({
      authorId,
      content: createPostDto.content,
      imageUrl: createPostDto.imageUrl,
    });

    const savedPost = await this.postRepository.save(post);
    return this.formatPost(savedPost, authorId);
  }

  async findOne(id: string, currentUserId?: string) {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return this.formatPost(post, currentUserId);
  }

  async delete(id: string, currentUserId: string) {
    const post = await this.postRepository.findOne({ where: { id } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.authorId !== currentUserId) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    await this.postRepository.remove(post);
    return { message: 'Post successfully deleted' };
  }

  async likePost(postId: string, userId: string) {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const existingLike = await this.likeRepository.findOne({
      where: { postId, userId },
    });

    if (!existingLike) {
      const like = this.likeRepository.create({ postId, userId });
      await this.likeRepository.save(like);

      post.likesCount += 1;
      await this.postRepository.save(post);
    }

    return { message: 'Post liked', isLiked: true, likesCount: post.likesCount };
  }

  async unlikePost(postId: string, userId: string) {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const existingLike = await this.likeRepository.findOne({
      where: { postId, userId },
    });

    if (existingLike) {
      await this.likeRepository.remove(existingLike);
      post.likesCount = Math.max(0, post.likesCount - 1);
      await this.postRepository.save(post);
    }

    return { message: 'Post unliked', isLiked: false, likesCount: post.likesCount };
  }

  async getUserPosts(userId: string, currentUserId?: string) {
    const posts = await this.postRepository.find({
      where: { authorId: userId },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(posts.map((p) => this.formatPost(p, currentUserId)));
  }

  async formatPost(post: Post, currentUserId?: string) {
    const author = await this.userRepository.findOne({ where: { id: post.authorId } });

    let isLiked = false;
    if (currentUserId) {
      const like = await this.likeRepository.findOne({
        where: { postId: post.id, userId: currentUserId },
      });
      isLiked = !!like;
    }

    const authorData = author
      ? {
          id: author.id,
          username: author.username,
          fullName: author.fullName,
          avatarUrl: author.avatarUrl,
        }
      : {
          id: post.authorId,
          username: 'unknown',
          fullName: 'Unknown User',
          avatarUrl: null,
        };

    return {
      id: post.id,
      content: post.content,
      imageUrl: post.imageUrl,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      author: authorData,
      isLiked,
      isOwner: currentUserId === post.authorId,
    };
  }
}
