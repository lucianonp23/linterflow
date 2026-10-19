import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from '../entities/comment.entity';
import { Post } from '../entities/post.entity';
import { User } from '../entities/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(postId: string, authorId: string, createCommentDto: CreateCommentDto) {
    const post = await this.postRepository.findOne({ where: { id: postId } });
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const comment = this.commentRepository.create({
      postId,
      authorId,
      content: createCommentDto.content,
    });

    const savedComment = await this.commentRepository.save(comment);

    post.commentsCount += 1;
    await this.postRepository.save(post);

    return this.formatComment(savedComment, authorId);
  }

  async findByPost(postId: string, currentUserId?: string) {
    const comments = await this.commentRepository.find({
      where: { postId },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(comments.map((c) => this.formatComment(c, currentUserId)));
  }

  async delete(commentId: string, currentUserId: string) {
    const comment = await this.commentRepository.findOne({ where: { id: commentId } });
    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    const post = await this.postRepository.findOne({ where: { id: comment.postId } });

    if (comment.authorId !== currentUserId && post?.authorId !== currentUserId) {
      throw new ForbiddenException('You can only delete your own comments or comments on your post');
    }

    await this.commentRepository.remove(comment);

    if (post) {
      post.commentsCount = Math.max(0, post.commentsCount - 1);
      await this.postRepository.save(post);
    }

    return { message: 'Comment successfully deleted' };
  }

  private async formatComment(comment: Comment, currentUserId?: string) {
    const author = await this.userRepository.findOne({ where: { id: comment.authorId } });

    const authorData = author
      ? {
          id: author.id,
          username: author.username,
          fullName: author.fullName,
          avatarUrl: author.avatarUrl,
        }
      : {
          id: comment.authorId,
          username: 'unknown',
          fullName: 'Unknown User',
          avatarUrl: null,
        };

    return {
      id: comment.id,
      postId: comment.postId,
      content: comment.content,
      createdAt: comment.createdAt,
      author: authorData,
      isOwner: currentUserId === comment.authorId,
    };
  }
}
