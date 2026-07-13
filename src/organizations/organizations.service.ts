import {ConflictException, Injectable, BadRequestException} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';

import {CreateOrganizationDto} from './dto/create-organization.dto';

import * as bcrypt from 'bcrypt';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrganizationDto) {
    const existing = await this.prisma.organization.findUnique({
      where: {
        code: dto.code,
      },
    });

    if (existing) {
      throw new ConflictException('Organization code already exists');
    }

    return this.prisma.organization.create({
      data: {
        name: dto.name,
        code: dto.code,
      },
    });
  }

  async createOrganizationWithAdmin(dto: CreateOrganizationDto) {
    return this.prisma.$transaction(async tx => {
      const existing = await tx.organization.findUnique({
        where: {
          code: dto.code,
        },
      });

      if (existing) {
        throw new ConflictException('Organization code already exists');
      }

      const organization = await tx.organization.create({
        data: {
          name: dto.name,
          code: dto.code,
        },
      });

      const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

      const admin = await tx.user.create({
        data: {
          email: dto.adminEmail,

          password: passwordHash,

          firstName: dto.adminFirstName,

          lastName: dto.adminLastName,

          organizationId: organization.id,
        },
      });

      const role = await tx.role.findUnique({
        where: {
          name: 'ORGANIZATION_ADMIN',
        },
      });

      if (!role) {
        throw new BadRequestException('ORGANIZATION_ADMIN role is missing');
      }

      await tx.userRole.create({
        data: {
          userId: admin.id,

          roleId: role.id,
        },
      });

      return {
        organization,

        admin: {
          id: admin.id,
          email: admin.email,
        },
      };
    });
  }

  async findAll() {
    return this.prisma.organization.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    return this.prisma.organization.findUnique({
      where: {
        id,
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.organization.update({
      where: {
        id,
      },

      data,
    });
  }

  async remove(id: string) {
    return this.prisma.organization.delete({
      where: {
        id,
      },
    });
  }
}
