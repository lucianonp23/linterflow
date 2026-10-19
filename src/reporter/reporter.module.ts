import { Module } from '@nestjs/common';
import { ReporterService } from './reporter.service';

@Module({
  providers: [ReporterService],
  exports: [ReporterService], // Exported so the ProducerModule can inject it.
})
export class ReporterModule {}
