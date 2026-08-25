import {ConflictException, Injectable, NotFoundException} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';

import {CreateDepartmentDto} from './dto/create-department.dto';
import {UpdateDepartmentDto} from './dto/update-department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Department code already exists in this organization');
    }

    return this.prisma.department.create({
      data: {
        name: dto.name,
        code: dto.code,
        organizationId,
      },
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.department.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findOne(organizationId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return department;
  }

  async update(organizationId: string, id: string, dto: UpdateDepartmentDto) {
    const department = await this.prisma.department.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    if (dto.code) {
      const existing = await this.prisma.department.findFirst({
        where: {
          organizationId,
          code: dto.code,
          NOT: {
            id,
          },
        },
      });

      if (existing) {
        throw new ConflictException('Department code already exists in this organization');
      }
    }

    return this.prisma.department.update({
      where: {
        id,
      },
      data: dto,
    });
  }

  async remove(organizationId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    await this.prisma.department.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Department deleted successfully',
    };
  }
}
