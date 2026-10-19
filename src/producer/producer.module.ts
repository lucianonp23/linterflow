import { Module } from '@nestjs/common';
import { ProducerService } from './producer.service';
import { ProducerController } from './producer.controller';
import { EvaluatorModule } from '../evaluator/evaluator.module';
import { FeedbackModule } from '../feedback/feedback.module';
import { ReporterModule } from '../reporter/reporter.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [EvaluatorModule, FeedbackModule, ReporterModule, CreditsModule],
  controllers: [ProducerController],
  providers: [ProducerService],
  exports: [ProducerService],
})
export class ProducerModule {}
