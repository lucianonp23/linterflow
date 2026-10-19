import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

export interface Employee {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  annualQuota: number;
  usedQuota: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  rejectionReason?: string;
  createdAt: string;
}

export class CreateLeaveRequestDto {
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string;
}

export class ApproveLeaveRequestDto {
  approverId: string;
}

export class RejectLeaveRequestDto {
  approverId: string;
  reason: string;
}

@Controller('leave-requests')
export class LeaveRequestController {
  private employees: Map<string, Employee> = new Map([
    ['emp-1', { id: 'emp-1', name: 'Alice Smith', status: 'ACTIVE', annualQuota: 25, usedQuota: 5 }],
    ['emp-2', { id: 'emp-2', name: 'Bob Jones', status: 'INACTIVE', annualQuota: 20, usedQuota: 0 }],
    ['emp-3', { id: 'emp-3', name: 'Charlie Brown', status: 'ACTIVE', annualQuota: 15, usedQuota: 12 }],
  ]);

  private leaveRequests: Map<string, LeaveRequest> = new Map();
  private idCounter = 1;

  @Post()
  createLeaveRequest(@Body() dto: CreateLeaveRequestDto) {
    const employee = this.employees.get(dto.employeeId);
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${dto.employeeId} not found`);
    }

    if (employee.status !== 'ACTIVE') {
      throw new ForbiddenException('Inactive employees cannot submit leave requests');
    }

    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      throw new BadRequestException('End date must be on or after start date');
    }

    const now = new Date();
    const minNoticeTime = now.getTime() + 24 * 60 * 60 * 1000;
    if (start.getTime() < minNoticeTime) {
      throw new BadRequestException('Leave requests must be submitted at least 24 hours in advance');
    }

    const durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;
    if (durationDays > 14) {
      throw new BadRequestException('Single leave request cannot exceed 14 consecutive days');
    }

    const remainingQuota = employee.annualQuota - employee.usedQuota;
    if (durationDays > remainingQuota) {
      throw new BadRequestException(`Insufficient leave quota. Requested: ${durationDays}, Remaining: ${remainingQuota}`);
    }

    const hasOverlap = Array.from(this.leaveRequests.values()).some((req) => {
      if (req.employeeId !== dto.employeeId) return false;
      if (req.status === 'REJECTED' || req.status === 'CANCELLED') return false;
      const reqStart = new Date(req.startDate);
      const reqEnd = new Date(req.endDate);
      return start <= reqEnd && end >= reqStart;
    });

    if (hasOverlap) {
      throw new ConflictException('Leave request overlaps with an existing pending or approved request');
    }

    const newRequest: LeaveRequest = {
      id: `req-${this.idCounter++}`,
      employeeId: dto.employeeId,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: 'PENDING',
      reason: dto.reason,
      createdAt: now.toISOString(),
    };

    this.leaveRequests.set(newRequest.id, newRequest);
    return newRequest;
  }

  @Put(':id/approve')
  approveLeaveRequest(@Param('id') id: string, @Body() dto: ApproveLeaveRequestDto) {
    const request = this.leaveRequests.get(id);
    if (!request) {
      throw new NotFoundException(`Leave request with ID ${id} not found`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot approve request in status ${request.status}`);
    }

    const approver = this.employees.get(dto.approverId);
    if (!approver || approver.status !== 'ACTIVE') {
      throw new ForbiddenException('Invalid or inactive approver');
    }

    if (dto.approverId === request.employeeId) {
      throw new ForbiddenException('Employees cannot approve their own leave requests');
    }

    const employee = this.employees.get(request.employeeId);
    if (!employee) {
      throw new NotFoundException('Employee associated with request not found');
    }

    const start = new Date(request.startDate);
    const end = new Date(request.endDate);
    const durationDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;

    if (employee.usedQuota + durationDays > employee.annualQuota) {
      throw new BadRequestException('Employee no longer has sufficient annual quota');
    }

    employee.usedQuota += durationDays;
    request.status = 'APPROVED';

    return { request, remainingQuota: employee.annualQuota - employee.usedQuota };
  }

  @Put(':id/reject')
  rejectLeaveRequest(@Param('id') id: string, @Body() dto: RejectLeaveRequestDto) {
    const request = this.leaveRequests.get(id);
    if (!request) {
      throw new NotFoundException(`Leave request with ID ${id} not found`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException(`Cannot reject request in status ${request.status}`);
    }

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('Rejection reason must be provided');
    }

    request.status = 'REJECTED';
    request.rejectionReason = dto.reason;

    return request;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancelLeaveRequest(@Param('id') id: string) {
    const request = this.leaveRequests.get(id);
    if (!request) {
      throw new NotFoundException(`Leave request with ID ${id} not found`);
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending leave requests can be cancelled');
    }

    const start = new Date(request.startDate);
    const now = new Date();
    if (start <= now) {
      throw new BadRequestException('Cannot cancel leave request that has already started or passed');
    }

    request.status = 'CANCELLED';
  }

  @Get()
  getLeaveRequests(@Query('employeeId') employeeId?: string, @Query('status') status?: string) {
    let results = Array.from(this.leaveRequests.values());

    if (employeeId) {
      results = results.filter((req) => req.employeeId === employeeId);
    }

    if (status) {
      results = results.filter((req) => req.status === status);
    }

    return results;
  }

  @Get('quota/:employeeId')
  getEmployeeQuota(@Param('employeeId') employeeId: string) {
    const employee = this.employees.get(employeeId);
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${employeeId} not found`);
    }

    return {
      employeeId: employee.id,
      annualQuota: employee.annualQuota,
      usedQuota: employee.usedQuota,
      remainingQuota: employee.annualQuota - employee.usedQuota,
    };
  }
}
