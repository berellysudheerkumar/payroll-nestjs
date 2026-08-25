import {Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards} from '@nestjs/common';

import {ApiTags} from '@nestjs/swagger';

import {DepartmentsService} from './departments.service';

import {CreateDepartmentDto} from './dto/create-department.dto';
import {UpdateDepartmentDto} from './dto/update-department.dto';

import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {Role} from 'src/roles/roles.enum';
import {Roles} from 'src/roles/roles.decorator';

@ApiTags('Departments')
@Controller('departments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Post()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  create(@Req() req: any, @Body() dto: CreateDepartmentDto) {
    return this.departmentsService.create(req.user.organizationId, dto);
  }

  @Get()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findAll(@Req() req: any) {
    return this.departmentsService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.departmentsService.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentsService.update(req.user.organizationId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.departmentsService.remove(req.user.organizationId, id);
  }
}
