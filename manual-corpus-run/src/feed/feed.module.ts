import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Post } from '../entities/post.entity';
import { Follow } from '../entities/follow.entity';
import { FeedService } from './feed.service';
import { FeedController } from './feed.controller';
import { PostsModule } from '../posts/posts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Post, Follow]),
    PostsModule,
  ],
  controllers: [FeedController],
  providers: [FeedService],
})
export class FeedModule {}
