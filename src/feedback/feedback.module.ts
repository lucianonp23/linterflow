import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service';

@Module({
  providers: [FeedbackService],
  exports: [FeedbackService], // Exporting the service so it can be used in other modules like ProducerModule
})
export class FeedbackModule {}
