import {Injectable, UnauthorizedException} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {JwtService} from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(data: any) {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,

        password: hashedPassword,

        firstName: data.firstName,

        lastName: data.lastName,

        organizationId: data.organizationId,
      },
    });

    return {
      id: user.id,
      email: user.email,
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
