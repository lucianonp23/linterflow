import { Global, Module } from '@nestjs/common';
import { AppEnvironmentService } from './app-environment.service';
import { AppConfigController } from './app-config.controller';

/**
 * Cross-cutting services that are not tied to one feature.
 *
 * Global because the environment decides what several unrelated modules may do,
 * and threading it through every module's imports would add wiring without
 * adding meaning.
 */
@Global()
@Module({
  controllers: [AppConfigController],
  providers: [AppEnvironmentService],
  exports: [AppEnvironmentService],
})
export class CoreModule {}
