import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {ApiOperation, ApiResponse, ApiTags} from '@nestjs/swagger';
import {JwtAuthGuard} from '../auth/guards/jwt-auth.guard';
import {Roles} from '../roles/roles.decorator';
import {Role} from '../roles/roles.enum';
import {RolesGuard} from '../roles/roles.guard';
import {AttendanceService} from './attendance.service';
import {AttendanceQueryDto} from './dto/attendance-query.dto';
import {CheckInDto} from './dto/check-in.dto';
import {CheckOutDto} from './dto/check-out.dto';
import {CreateAttendanceDto} from './dto/create-attendance.dto';
import {UpdateAttendanceDto} from './dto/update-attendance.dto';

@ApiTags('Attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Post('check-in')
  @ApiOperation({summary: 'Clock in for the day'})
  @ApiResponse({status: 201, description: 'Check-in recorded successfully'})
  @ApiResponse({status: 409, description: 'Already checked in for today'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE)
  checkIn(@Req() req: any, @Body() dto: CheckInDto) {
    return this.attendanceService.checkIn(req.user.organizationId, req.user.email, dto);
  }

  @Post('check-out')
  @ApiOperation({summary: 'Clock out for the day'})
  @ApiResponse({status: 200, description: 'Check-out recorded and working hours calculated'})
  @ApiResponse({status: 400, description: 'No active check-in found for today'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE)
  checkOut(@Req() req: any, @Body() dto: CheckOutDto) {
    return this.attendanceService.checkOut(req.user.organizationId, req.user.email, dto);
  }

  @Post()
  @ApiOperation({summary: 'Manually create an attendance record (Admin/HR)'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  create(@Req() req: any, @Body() dto: CreateAttendanceDto) {
    return this.attendanceService.create(req.user.organizationId, dto);
  }

  @Get('my-attendance')
  @ApiOperation({summary: 'Get attendance history of currently authenticated employee'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE)
  async getMyAttendance(@Req() req: any, @Query() query: AttendanceQueryDto) {
    const employeeId = await this.attendanceService.resolveEmployeeId(
      req.user.organizationId,
      req.user.email,
    );
    return this.attendanceService.findAll(req.user.organizationId, {
      ...query,
      employeeId,
    });
  }

  @Get('summary')
  @ApiOperation({summary: 'Get aggregated attendance metrics (present, absent, total hours, etc.)'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  getSummary(@Req() req: any, @Query() query: AttendanceQueryDto) {
    return this.attendanceService.getSummary(req.user.organizationId, query);
  }

  @Get()
  @ApiOperation({summary: 'List attendance records with filters and pagination'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findAll(@Req() req: any, @Query() query: AttendanceQueryDto) {
    return this.attendanceService.findAll(req.user.organizationId, query);
  }

  @Get(':id')
  @ApiOperation({summary: 'Get single attendance record details by ID'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.attendanceService.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({summary: 'Regularize or update an attendance record'})
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return this.attendanceService.update(req.user.organizationId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({summary: 'Delete an attendance record'})
  @Roles(Role.ORGANIZATION_ADMIN)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.attendanceService.remove(req.user.organizationId, id);
  }
}
