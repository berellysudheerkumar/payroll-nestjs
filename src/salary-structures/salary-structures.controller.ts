import {Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards} from '@nestjs/common';

import {ApiTags} from '@nestjs/swagger';

import {SalaryStructuresService} from './salary-structures.service';

import {CreateSalaryStructureDto} from './dto/create-salary-structure.dto';
import {UpdateSalaryStructureDto} from './dto/update-salary-structure.dto';

import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {Role} from 'src/roles/roles.enum';
import {Roles} from 'src/roles/roles.decorator';

@ApiTags('Salary Structures')
@Controller('salary-structures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SalaryStructuresController {
  constructor(private readonly salaryStructuresService: SalaryStructuresService) {}

  @Post()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  create(@Req() req: any, @Body() dto: CreateSalaryStructureDto) {
    return this.salaryStructuresService.create(req.user.organizationId, dto);
  }

  @Get()
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findAll(@Req() req: any) {
    return this.salaryStructuresService.findAll(req.user.organizationId);
  }

  @Get(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.salaryStructuresService.findOne(req.user.organizationId, id);
  }

  @Patch(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateSalaryStructureDto) {
    return this.salaryStructuresService.update(req.user.organizationId, id, dto);
  }

  @Delete(':id')
  @Roles(Role.ORGANIZATION_ADMIN, Role.HR_ADMIN)
  remove(@Req() req: any, @Param('id') id: string) {
    return this.salaryStructuresService.remove(req.user.organizationId, id);
  }
}
