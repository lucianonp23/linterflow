import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { AdminController } from './admin.controller';
import { RunsModule } from '../runs/runs.module';

@Module({
  imports: [RunsModule],
  controllers: [AdminController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
