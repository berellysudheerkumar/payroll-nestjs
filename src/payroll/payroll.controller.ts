import {Body, Controller, Get, Post, Res, Req, Param, UseGuards} from '@nestjs/common';
import type {Response} from 'express';

import {ApiTags} from '@nestjs/swagger';

import {PayrollService} from './payroll.service';
import {CreatePayrollPeriodDto} from './dto/create-payroll-period.dto';
import {CreatePayrollRunDto} from './dto/create-payroll-run.dto';
import {MarkPayrollPaidDto} from './dto/create-payroll-run.dto';

import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {Roles} from 'src/roles/roles.decorator';
import {Role} from 'src/roles/roles.enum';

@ApiTags('Payroll')
@Controller('payroll')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('periods')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  createPeriod(@Req() req: any, @Body() dto: CreatePayrollPeriodDto) {
    return this.payrollService.createPeriod(req.user.organizationId, dto);
  }

  @Get('periods')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  getPeriods(@Req() req: any) {
    return this.payrollService.getPeriods(req.user.organizationId);
  }

  @Get('runs')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  getRuns(@Req() req: any) {
    return this.payrollService.getRuns(req.user.organizationId);
  }

  @Post('runs')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  createRun(@Req() req: any, @Body() dto: CreatePayrollRunDto) {
    return this.payrollService.createRun(req.user.organizationId, dto, req.user.id);
  }

  @Post('runs/:id/process')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  processRun(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.processRun(req.user.organizationId, id, req.user.id);
  }

  @Get('runs/:id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  getRun(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.getRun(req.user.organizationId, id);
  }

  @Post('runs/:id/approve')
  @Roles(Role.ORGANIZATION_ADMIN)
  approve(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.approve(req.user.organizationId, id, req.user.id);
  }

  @Post('runs/:id/cancel')
  @Roles(Role.ORGANIZATION_ADMIN)
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.cancel(req.user.organizationId, id, req.user.id);
  }
  @Get('runs/:id/audits')
  @Roles(Role.ORGANIZATION_ADMIN)
  getAudits(@Req() req: any, @Param('id') id: string) {
    return this.payrollService.getAudits(req.user.organizationId, id);
  }

  @Post('runs/:id/pay')
  @Roles(Role.ORGANIZATION_ADMIN)
  markAsPaid(@Req() req: any, @Param('id') id: string, @Body() dto: MarkPayrollPaidDto) {
    return this.payrollService.markAsPaid(
      req.user.organizationId,
      id,
      req.user.id,
      dto.paymentReference,
    );
  }

  @Get('runs/:id/history')
  async getRunHistory(@Req() req, @Param('id') payrollRunId: string) {
    return this.payrollService.getRunHistory(req.user.organizationId, payrollRunId);
  }

  @Get('runs/:id/summary')
  async getPayrollSummary(@Req() req, @Param('id') payrollRunId: string) {
    return this.payrollService.getPayrollSummary(req.user.organizationId, payrollRunId);
  }
  @Get('runs/:id/employees')
  async getPayrollEmployeeReport(@Req() req, @Param('id') payrollRunId: string) {
    return this.payrollService.getPayrollEmployeeReport(req.user.organizationId, payrollRunId);
  }

  @Get('runs/:id/export')
  async exportPayrollRun(@Req() req, @Param('id') payrollRunId: string, @Res() res: Response) {
    const result = await this.payrollService.exportPayrollRun(
      req.user.organizationId,
      payrollRunId,
    );

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',

      'Content-Disposition': `attachment; filename="${result.fileName}"`,
    });

    res.send(result.buffer);
  }
  @Get('runs/:runId/payslips/:employeeId')
  async generatePayslip(
    @Req() req,
    @Param('runId') payrollRunId: string,
    @Param('employeeId') employeeId: string,
    @Res() res: Response,
  ) {
    const result = await this.payrollService.generatePayslip(
      req.user.organizationId,
      payrollRunId,
      employeeId,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${result.fileName}"`,
      'Content-Length': result.buffer.length.toString(),
    });

    res.send(result.buffer);
  }
}
