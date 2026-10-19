import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProducerModule } from './producer/producer.module';
import { EvaluatorModule } from './evaluator/evaluator.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ReporterModule } from './reporter/reporter.module';
import { GithubModule } from './github/github.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CreditsModule } from './credits/credits.module';
import { RunsModule } from './runs/runs.module';
import { DuplicationModule } from './duplication/duplication.module';
import { CoreModule } from './core/core.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available everywhere
    }),
    ScheduleModule.forRoot(), // Enables the temp/ cleanup cron job
    CoreModule,
    ProducerModule,
    EvaluatorModule,
    FeedbackModule,
    ReporterModule,
    GithubModule,
    AuthModule,
    UsersModule,
    CreditsModule,
    RunsModule,
    DuplicationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
