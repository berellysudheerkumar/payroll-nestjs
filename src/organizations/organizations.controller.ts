import {Body, Controller, Delete, Get, Param, Patch, Post, UseGuards} from '@nestjs/common';

import {ApiTags} from '@nestjs/swagger';

import {OrganizationsService} from './organizations.service';

import {CreateOrganizationDto} from './dto/create-organization.dto';

import {UpdateOrganizationDto} from './dto/update-organization.dto';
import {JwtAuthGuard} from 'src/auth/guards/jwt-auth.guard';
import {RolesGuard} from 'src/roles/roles.guard';
import {CreateOrganizationAdminDto} from './dto/create-organization-admin.dto';
import {Role} from 'src/roles/roles.enum';
import {Roles} from 'src/roles/roles.decorator';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  create(@Body() dto: CreateOrganizationDto) {
    return this.organizationsService.create(dto);
  }

  @Get()
  findAll() {
    return this.organizationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,

    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
  @Post('onboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  createOrganizationWithAdmin(
    @Body()
    dto: CreateOrganizationAdminDto,
  ) {
    return this.organizationsService.createOrganizationWithAdmin(dto);
  }
}
