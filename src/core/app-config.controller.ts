import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppEnvironmentService } from './app-environment.service';

/**
 * What this deployment allows, so the UI can render only what will work.
 *
 * Unauthenticated on purpose. It exposes nothing an attacker could not learn by
 * calling `/api/orchestrator/start` once and reading the status code, and the
 * login screen is drawn before a token exists — gating it would mean the UI
 * could not lay itself out until after sign-in.
 */
@ApiTags('config')
@Controller('api/config')
export class AppConfigController {
  constructor(private readonly appEnvironment: AppEnvironmentService) {}

  @Get()
  @ApiOperation({
    summary: 'Capabilities of this deployment',
    description:
      'Reports the environment and whether analysis by local path is available. In production only the GitHub import route is served.',
  })
  @ApiOkResponse({
    schema: {
      example: { environment: 'staging', localPathAnalysisEnabled: true },
    },
  })
  public getConfig() {
    return {
      environment: this.appEnvironment.current,
      localPathAnalysisEnabled:
        this.appEnvironment.isLocalPathAnalysisEnabled(),
    };
  }
}
