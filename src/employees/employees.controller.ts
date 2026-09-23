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

import {ApiTags} from '@nestjs/swagger';

import {EmployeesService} from './employees.service';

import {CreateEmployeeDto} from './dto/create-employee.dto';
import {UpdateEmployeeDto} from './dto/update-employee.dto';

import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {Roles} from 'src/roles/roles.decorator';
import {Role} from 'src/roles/roles.enum';

@ApiTags('Employees')
@Controller('employees')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Post()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  create(@Req() req: any, @Body() dto: CreateEmployeeDto) {
    return this.employeesService.create(req.user.organizationId, dto);
  }

  @Get()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findAll(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('departmentId') departmentId?: string,
    @Query('status') status?: string,
  ) {
    return this.employeesService.findAll(req.user.organizationId, search, departmentId, status);
  }

  @Get('me')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN, Role.EMPLOYEE)
  getMyProfile(@Req() req: any) {
    return this.employeesService.getMyProfile(req.user.organizationId, req.user.email);
  }

  @Get(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.employeesService.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.employeesService.update(req.user.organizationId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.employeesService.remove(req.user.organizationId, id);
  }
}
