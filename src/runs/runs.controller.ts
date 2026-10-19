import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RunsService } from './runs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from '../users/user.types';

@ApiTags('runs')
@ApiBearerAuth()
@Controller('api/runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  /** GET /api/runs/mine — the authenticated account's pipeline history. */
  @Get('mine')
  @ApiOperation({ summary: 'Pipeline run history for the current account' })
  public listMine(@CurrentUser() principal: AuthPrincipal) {
    return this.runsService.listByOwner(principal.sub);
  }
}
