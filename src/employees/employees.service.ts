import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';

import {CreateEmployeeDto} from './dto/create-employee.dto';
import {UpdateEmployeeDto} from './dto/update-employee.dto';
import {EmploymentStatus} from '@prisma/client';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, dto: CreateEmployeeDto) {
    const existing = await this.prisma.employee.findUnique({
      where: {
        organizationId_employeeCode: {
          organizationId,
          employeeCode: dto.employeeCode,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Employee code already exists in this organization');
    }

    if (dto.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: {
          id: dto.departmentId,
          organizationId,
        },
      });

      if (!department) {
        throw new BadRequestException('Department does not belong to this organization');
      }
    }

    return this.prisma.employee.create({
      data: {
        employeeCode: dto.employeeCode,

        firstName: dto.firstName,
        lastName: dto.lastName,

        email: dto.email,
        phone: dto.phone,

        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,

        dateOfJoining: new Date(dto.dateOfJoining),

        departmentId: dto.departmentId,

        employmentType: dto.employmentType ?? 'FULL_TIME',

        organizationId,
      },
    });
  }

  async findAll(organizationId: string, search?: string, departmentId?: string, status?: string) {
    const employmentStatus =
      status && Object.values(EmploymentStatus).includes(status as EmploymentStatus)
        ? (status as EmploymentStatus)
        : undefined;

    return this.prisma.employee.findMany({
      where: {
        organizationId,

        ...(search
          ? {
              OR: [
                {
                  employeeCode: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  firstName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  lastName: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  email: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),

        ...(departmentId
          ? {
              departmentId,
            }
          : {}),

        ...(employmentStatus
          ? {
              employmentStatus,
            }
          : {}),
      },

      include: {
        department: true,
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        department: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  async update(organizationId: string, id: string, dto: UpdateEmployeeDto) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (dto.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: {
          id: dto.departmentId,
          organizationId,
        },
      });

      if (!department) {
        throw new BadRequestException('Department does not belong to this organization');
      }
    }

    return this.prisma.employee.update({
      where: {
        id,
      },
      data: {
        employeeCode: dto.employeeCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,

        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,

        dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,

        departmentId: dto.departmentId,

        employmentType: dto.employmentType,

        employmentStatus: dto.employmentStatus,

        dateOfLeaving: dto.dateOfLeaving ? new Date(dto.dateOfLeaving) : undefined,
      },
    });
  }

  async remove(organizationId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    await this.prisma.employee.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Employee deleted successfully',
    };
  }
}
