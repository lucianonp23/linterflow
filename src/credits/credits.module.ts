import { Module } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { PipelineBillingService } from './pipeline-billing.service';
import { UsersModule } from '../users/users.module';
import { RunsModule } from '../runs/runs.module';

@Module({
  imports: [UsersModule, RunsModule],
  providers: [CreditsService, PipelineBillingService],
  exports: [CreditsService, PipelineBillingService],
})
export class CreditsModule {}
