import { Module } from '@nestjs/common';
import { GithubService } from './github.service';
import { GithubCleanupService } from './github-cleanup.service';
import { GithubController } from './github.controller';
import { ProducerModule } from '../producer/producer.module';
import { ReporterModule } from '../reporter/reporter.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [ProducerModule, ReporterModule, CreditsModule],
  controllers: [GithubController],
  providers: [GithubService, GithubCleanupService],
})
export class GithubModule {}
