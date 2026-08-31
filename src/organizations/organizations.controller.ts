import {Body, Controller, Delete, Get, Param, Patch, Post, UseGuards} from '@nestjs/common';

import {ApiTags} from '@nestjs/swagger';

import {OrganizationsService} from './organizations.service';
import {CreateOrganizationAdminDto} from './dto/create-organization-admin.dto';
import {UpdateOrganizationDto} from './dto/update-organization.dto';
import {UpdateOrganizationAdministratorDto} from './dto/update-organization-administrator.dto';

import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {Role} from 'src/roles/roles.enum';
import {Roles} from 'src/roles/roles.decorator';

@ApiTags('Organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post('onboard')
  @Roles(Role.SUPER_ADMIN)
  createOrganizationWithAdmin(@Body() dto: CreateOrganizationAdminDto) {
    return this.organizationsService.createOrganizationWithAdmin(dto);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN)
  findAll() {
    return this.organizationsService.findAll();
  }

  @Get('dashboard/summary')
  @Roles(Role.SUPER_ADMIN)
  getDashboardSummary() {
    return this.organizationsService.getDashboardSummary();
  }

  @Get('administrators')
  @Roles(Role.SUPER_ADMIN)
  findAdministrators() {
    return this.organizationsService.findAdministrators();
  }

  @Get('administrators/:id')
  @Roles(Role.SUPER_ADMIN)
  findAdministrator(@Param('id') id: string) {
    return this.organizationsService.findAdministrator(id);
  }

  @Patch('administrators/:id')
  @Roles(Role.SUPER_ADMIN)
  updateAdministrator(@Param('id') id: string, @Body() dto: UpdateOrganizationAdministratorDto) {
    return this.organizationsService.updateAdministrator(id, dto);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN)
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.SUPER_ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
}
