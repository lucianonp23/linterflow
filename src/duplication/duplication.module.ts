import { Module } from '@nestjs/common';
import { DuplicationController } from './duplication.controller';
import { DuplicationService } from './duplication.service';

/**
 * Project-level duplication measurement.
 *
 * Its own module rather than an addition to EvaluatorModule: the Evaluator is
 * the instrument the committed corpus results were produced with, and leaving
 * it untouched is what keeps those results comparable with the code that
 * produced them. Nothing here is on the pipeline's path.
 */
@Module({
  controllers: [DuplicationController],
  providers: [DuplicationService],
  exports: [DuplicationService],
})
export class DuplicationModule {}
