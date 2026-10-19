import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { RunsService } from '../runs/runs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthPrincipal } from './user.types';
import {
  ApproveUserDto,
  UpdateCreditsDto,
  UpdateSettingsDto,
  ValidateReportDto,
} from './dto/admin.dto';

/**
 * Admin panel API: user approval, credit management, guest limit
 * configuration, full run history and report validation.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('api/admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly runsService: RunsService,
  ) {}

  /* --------------------------- user management ---------------------------- */

  @Get('users')
  @ApiOperation({ summary: 'List every registered account with status and credits' })
  public listUsers() {
    return this.usersService.listUsers();
  }

  @Post('users/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a pending user and set their credit allowance' })
  public approveUser(@Param('id') id: string, @Body() dto: ApproveUserDto) {
    return this.usersService.approve(id, dto.credits);
  }

  @Post('users/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a pending user registration' })
  public rejectUser(@Param('id') id: string) {
    return this.usersService.reject(id);
  }

  @Patch('users/:id/credits')
  @ApiOperation({ summary: "Overwrite a user's remaining credit balance" })
  public updateCredits(@Param('id') id: string, @Body() dto: UpdateCreditsDto) {
    return this.usersService.setCredits(id, dto.credits);
  }

  @Get('users/:id/history')
  @ApiOperation({ summary: 'Pipeline run history for a specific account' })
  public userHistory(@Param('id') id: string) {
    return this.runsService.listByOwner(id);
  }

  /* ------------------------------- settings -------------------------------- */

  @Get('settings')
  @ApiOperation({ summary: 'Current app settings (guest credit limit)' })
  public getSettings() {
    return this.usersService.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update the guest credit limit' })
  public updateSettings(@Body() dto: UpdateSettingsDto) {
    return this.usersService.updateSettings({
      guestCreditLimit: dto.guestCreditLimit,
    });
  }

  /* ------------------------- runs / report review -------------------------- */

  @Get('runs')
  @ApiOperation({ summary: 'Every pipeline run across all accounts' })
  public listRuns() {
    return this.runsService.listAll();
  }

  @Post('runs/:id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate or reject a generated mitigation report' })
  public validateRun(
    @Param('id') id: string,
    @Body() dto: ValidateReportDto,
    @CurrentUser() principal: AuthPrincipal,
  ) {
    return this.runsService.validate(
      id,
      principal.name ?? principal.email ?? 'admin',
      dto.decision,
      dto.notes,
    );
  }
}
