import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {JwtService} from '@nestjs/jwt';
import {EmployeeSignUpDto} from './dto/employee-signup.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(data: any) {
    const existing = await this.prisma.user.findUnique({
      where: {email: data.email},
    });

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Resolve or default role (e.g. EMPLOYEE, ORGANIZATION_ADMIN, HR_ADMIN)
    const roleName = data.role || 'EMPLOYEE';
    const roleRecord = await this.prisma.role.upsert({
      where: {name: roleName},
      update: {},
      create: {name: roleName},
    });

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        firstName: data.firstName,
        lastName: data.lastName,
        organizationId: data.organizationId || null,
        roles: {
          create: {
            roleId: roleRecord.id,
          },
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    // If role is EMPLOYEE and organizationId is provided, ensure a matching Employee profile exists
    if (data.organizationId && roleName === 'EMPLOYEE') {
      const existingEmployee = await this.prisma.employee.findFirst({
        where: {email: data.email, organizationId: data.organizationId},
      });

      if (!existingEmployee) {
        const employeeCode = data.employeeCode || `EMP-${Date.now().toString().slice(-6)}`;
        await this.prisma.employee.create({
          data: {
            employeeCode,
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            organizationId: data.organizationId,
            dateOfJoining: data.dateOfJoining ? new Date(data.dateOfJoining) : new Date(),
            departmentId: data.departmentId || null,
          },
        });
      }
    }

    return {
      id: user.id,
      email: user.email,
      roles: user.roles.map(r => r.role.name),
      organizationId: user.organizationId,
    };
  }

  async registerEmployee(dto: EmployeeSignUpDto) {
    const orgCode = dto.organizationCode.trim().toUpperCase();
    const organization = await this.prisma.organization.findUnique({
      where: {code: orgCode},
    });

    if (!organization) {
      throw new NotFoundException(
        `Organization with code "${dto.organizationCode}" was not found. Please verify the code with your administrator.`,
      );
    }

    const email = dto.email.trim().toLowerCase();
    const existingUser = await this.prisma.user.findUnique({
      where: {email},
    });

    if (existingUser) {
      throw new ConflictException('An account with this email already exists. Please log in.');
    }

    if (dto.employeeCode) {
      const codeConflict = await this.prisma.employee.findFirst({
        where: {
          organizationId: organization.id,
          employeeCode: dto.employeeCode.trim(),
          NOT: {email},
        },
      });
      if (codeConflict) {
        throw new ConflictException(
          `Employee code "${dto.employeeCode}" is already in use by another employee in this organization.`,
        );
      }
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const roleRecord = await this.prisma.role.upsert({
      where: {name: 'EMPLOYEE'},
      update: {},
      create: {name: 'EMPLOYEE'},
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        organizationId: organization.id,
        roles: {
          create: {
            roleId: roleRecord.id,
          },
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    const existingEmployee = await this.prisma.employee.findFirst({
      where: {
        email,
        organizationId: organization.id,
      },
    });

    if (!existingEmployee) {
      const finalCode = dto.employeeCode?.trim() || `EMP-${Date.now().toString().slice(-6)}`;
      await this.prisma.employee.create({
        data: {
          employeeCode: finalCode,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          email,
          organizationId: organization.id,
          dateOfJoining: new Date(),
        },
      });
    }

    const roles = ['EMPLOYEE'];

    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      roles,
    });

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationId: user.organizationId,
        roles,
      },
    };
  }

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = user.roles.map(userRole => userRole.role.name);

    const token = this.jwt.sign({
      sub: user.id,
      email: user.email,
      organizationId: user.organizationId,
      roles,
    });

    return {
      access_token: token,

      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organizationId: user.organizationId,
        roles,
      },
    };
  }
}
