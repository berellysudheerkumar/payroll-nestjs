import {
  ConflictException,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';

import {CreateOrganizationDto} from './dto/create-organization.dto';
import {UpdateOrganizationAdministratorDto} from './dto/update-organization-administrator.dto';

import * as bcrypt from 'bcrypt';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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
    const organization = await this.prisma.organization.findUnique({
      where: {
        id,
      },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            roles: {
              include: {
                role: true,
              },
            },
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
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

  async getDashboardSummary() {
    const now = new Date();

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [
      totalOrganizations,
      totalUsers,
      organizationAdmins,
      organizationsThisMonth,
      organizationsToday,
      recentOrganizations,
    ] = await this.prisma.$transaction([
      // Total organizations
      this.prisma.organization.count(),

      // Total users across the platform
      this.prisma.user.count(),

      // Organization administrators
      this.prisma.userRole.count({
        where: {
          role: {
            name: 'ORGANIZATION_ADMIN',
          },
        },
      }),

      // Organizations created this month
      this.prisma.organization.count({
        where: {
          createdAt: {
            gte: startOfMonth,
            lt: startOfNextMonth,
          },
        },
      }),

      // Organizations created today
      this.prisma.organization.count({
        where: {
          createdAt: {
            gte: startOfDay,
            lt: startOfTomorrow,
          },
        },
      }),

      // Most recently created organizations
      this.prisma.organization.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 5,
        select: {
          id: true,
          name: true,
          code: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalOrganizations,
      totalUsers,
      organizationAdmins,
      organizationsThisMonth,
      organizationsToday,
      recentOrganizations,
    };
  }

  async findAdministrators() {
    return this.prisma.user.findMany({
      where: {
        roles: {
          some: {
            role: {
              name: 'ORGANIZATION_ADMIN',
            },
          },
        },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,

        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },

        roles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findAdministrator(id: string) {
    const administrator = await this.prisma.user.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,

        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },

        roles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (!administrator) {
      throw new NotFoundException('Administrator not found');
    }

    const isOrganizationAdmin = administrator.roles.some(
      userRole => userRole.role.name === 'ORGANIZATION_ADMIN',
    );

    if (!isOrganizationAdmin) {
      throw new NotFoundException('Administrator not found');
    }

    return administrator;
  }

  async updateAdministrator(id: string, dto: UpdateOrganizationAdministratorDto) {
    const administrator = await this.prisma.user.findFirst({
      where: {
        id,
        roles: {
          some: {
            role: {
              name: 'ORGANIZATION_ADMIN',
            },
          },
        },
      },
    });

    if (!administrator) {
      throw new NotFoundException('Administrator not found');
    }

    if (dto.email && dto.email !== administrator.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: {
          email: dto.email,
        },
      });

      if (existingUser && existingUser.id !== id) {
        throw new ConflictException('Email address already exists');
      }
    }

    if (dto.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: {
          id: dto.organizationId,
        },
      });

      if (!organization) {
        throw new NotFoundException('Organization not found');
      }
    }

    return this.prisma.user.update({
      where: {
        id,
      },
      data: {
        ...(dto.firstName !== undefined && {
          firstName: dto.firstName,
        }),

        ...(dto.lastName !== undefined && {
          lastName: dto.lastName,
        }),

        ...(dto.email !== undefined && {
          email: dto.email,
        }),

        ...(dto.organizationId !== undefined && {
          organizationId: dto.organizationId,
        }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        organizationId: true,

        organization: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },

        roles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },

        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
