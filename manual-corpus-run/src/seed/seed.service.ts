import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';
import { Follow } from '../entities/follow.entity';
import { Post } from '../entities/post.entity';
import { Comment } from '../entities/comment.entity';
import { Like } from '../entities/like.entity';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Follow)
    private readonly followRepository: Repository<Follow>,
    @InjectRepository(Post)
    private readonly postRepository: Repository<Post>,
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Like)
    private readonly likeRepository: Repository<Like>,
  ) {}

  async onApplicationBootstrap() {
    const userCount = await this.userRepository.count();
    if (userCount > 0) {
      this.logger.log('Database already initialized with data.');
      return;
    }

    this.logger.log('Seeding initial social network demo data...');

    const defaultPasswordHash = await bcrypt.hash('password123', 10);

    // 1. Create Demo Users
    const alex = await this.userRepository.save(
      this.userRepository.create({
        username: 'alex_dev',
        email: 'alex@example.com',
        passwordHash: defaultPasswordHash,
        fullName: 'Alex Morgan',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        bio: 'Fullstack developer building cool apps in NestJS & TypeScript! 🚀',
      }),
    );

    const sarah = await this.userRepository.save(
      this.userRepository.create({
        username: 'sarah_design',
        email: 'sarah@example.com',
        passwordHash: defaultPasswordHash,
        fullName: 'Sarah Chen',
        avatarUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&auto=format&fit=crop&q=80',
        bio: 'UI/UX Designer. Pixel perfectionist & glassmorphism enthusiast ✨',
      }),
    );

    const techGuru = await this.userRepository.save(
      this.userRepository.create({
        username: 'tech_guru',
        email: 'guru@example.com',
        passwordHash: defaultPasswordHash,
        fullName: 'Marcus Vance',
        avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
        bio: 'Tech lead & open source contributor. Passionate about scalable architectures.',
      }),
    );

    const elena = await this.userRepository.save(
      this.userRepository.create({
        username: 'elena_ai',
        email: 'elena@example.com',
        passwordHash: defaultPasswordHash,
        fullName: 'Elena Rostova',
        avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80',
        bio: 'AI researcher & data scientist. Exploring LLMs and multi-agent systems 🤖',
      }),
    );

    // 2. Create Follow Relationships
    // Alex follows Sarah, TechGuru, Elena
    await this.followRepository.save([
      this.followRepository.create({ followerId: alex.id, followingId: sarah.id }),
      this.followRepository.create({ followerId: alex.id, followingId: techGuru.id }),
      this.followRepository.create({ followerId: alex.id, followingId: elena.id }),
      // Sarah follows Alex and Elena
      this.followRepository.create({ followerId: sarah.id, followingId: alex.id }),
      this.followRepository.create({ followerId: sarah.id, followingId: elena.id }),
      // TechGuru follows Alex and Sarah
      this.followRepository.create({ followerId: techGuru.id, followingId: alex.id }),
      this.followRepository.create({ followerId: techGuru.id, followingId: sarah.id }),
    ]);

    // 3. Create Sample Posts
    const post1 = await this.postRepository.save(
      this.postRepository.create({
        authorId: sarah.id,
        content: 'Just published our new UI design system tokens! Clean typography, vibrant accents, and sleek dark mode support. What do you all think? 🎨',
        imageUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
        likesCount: 3,
        commentsCount: 2,
      }),
    );

    const post2 = await this.postRepository.save(
      this.postRepository.create({
        authorId: alex.id,
        content: 'Building a complete social network API with NestJS in TypeScript. The modular architecture and dependency injection make backend dev so clean!',
        imageUrl: null,
        likesCount: 2,
        commentsCount: 1,
      }),
    );

    const post3 = await this.postRepository.save(
      this.postRepository.create({
        authorId: techGuru.id,
        content: 'Tip of the day: Always keep your database queries indexed for foreign key lookups. Timeline feeds scale significantly better with covered indexes!',
        imageUrl: null,
        likesCount: 4,
        commentsCount: 1,
      }),
    );

    const post4 = await this.postRepository.save(
      this.postRepository.create({
        authorId: elena.id,
        content: 'Autonomous AI agents are getting smarter every week. Exciting times ahead for software engineering! 🚀🤖',
        imageUrl: 'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=800&auto=format&fit=crop&q=80',
        likesCount: 5,
        commentsCount: 2,
      }),
    );

    // 4. Create Comments
    await this.commentRepository.save([
      this.commentRepository.create({
        postId: post1.id,
        authorId: alex.id,
        content: 'The glassmorphism effects look unbelievable! Super crisp 👏',
      }),
      this.commentRepository.create({
        postId: post1.id,
        authorId: techGuru.id,
        content: 'Love the contrast ratio on dark mode!',
      }),
      this.commentRepository.create({
        postId: post2.id,
        authorId: sarah.id,
        content: 'NestJS + TypeORM is a fantastic stack! 🔥',
      }),
      this.commentRepository.create({
        postId: post3.id,
        authorId: alex.id,
        content: '100%! Compound index on (followerId, followingId) works like magic.',
      }),
      this.commentRepository.create({
        postId: post4.id,
        authorId: techGuru.id,
        content: 'Agreed, agentic workflows are changing dev tools completely!',
      }),
      this.commentRepository.create({
        postId: post4.id,
        authorId: sarah.id,
        content: 'Fascinating read Elena!',
      }),
    ]);

    // 5. Create Likes
    await this.likeRepository.save([
      this.likeRepository.create({ postId: post1.id, userId: alex.id }),
      this.likeRepository.create({ postId: post1.id, userId: techGuru.id }),
      this.likeRepository.create({ postId: post1.id, userId: elena.id }),

      this.likeRepository.create({ postId: post2.id, userId: sarah.id }),
      this.likeRepository.create({ postId: post2.id, userId: techGuru.id }),

      this.likeRepository.create({ postId: post3.id, userId: alex.id }),
      this.likeRepository.create({ postId: post3.id, userId: sarah.id }),
      this.likeRepository.create({ postId: post3.id, userId: elena.id }),

      this.likeRepository.create({ postId: post4.id, userId: alex.id }),
      this.likeRepository.create({ postId: post4.id, userId: sarah.id }),
      this.likeRepository.create({ postId: post4.id, userId: techGuru.id }),
    ]);

    this.logger.log('Database seeding completed successfully.');
  }
}
