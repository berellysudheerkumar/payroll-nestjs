import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {AttendanceStatus, Prisma} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {AttendanceQueryDto} from './dto/attendance-query.dto';
import {CheckInDto} from './dto/check-in.dto';
import {CheckOutDto} from './dto/check-out.dto';
import {CreateAttendanceDto} from './dto/create-attendance.dto';
import {UpdateAttendanceDto} from './dto/update-attendance.dto';

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Normalize date to UTC midnight for consistent daily indexing
   */
  private normalizeDate(dateInput?: string | Date): Date {
    const d = dateInput ? new Date(dateInput) : new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  /**
   * Helper: Calculate working minutes between checkIn and checkOut
   */
  private calculateWorkingMinutes(checkIn: Date, checkOut: Date): number {
    const diffMs = checkOut.getTime() - checkIn.getTime();
    return Math.max(0, Math.round(diffMs / (1000 * 60)));
  }

  /**
   * Helper: Resolve employee ID by organization and either direct ID or user email
   */
  async resolveEmployeeId(
    organizationId: string,
    userEmail?: string,
    targetEmployeeId?: string,
  ): Promise<string> {
    if (targetEmployeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: {id: targetEmployeeId, organizationId},
      });
      if (!employee) {
        throw new NotFoundException(
          `Employee with ID '${targetEmployeeId}' not found in this organization.`,
        );
      }
      return employee.id;
    }

    if (!userEmail) {
      throw new BadRequestException('Employee ID or authenticated user email is required.');
    }

    const employee = await this.prisma.employee.findFirst({
      where: {email: userEmail, organizationId},
    });

    if (!employee) {
      throw new NotFoundException(
        `No employee profile found for user '${userEmail}'. Please specify employeeId.`,
      );
    }

    return employee.id;
  }

  /**
   * Check in an employee
   */
  async checkIn(organizationId: string, userEmail: string, dto: CheckInDto) {
    const employeeId = await this.resolveEmployeeId(organizationId, userEmail, dto.employeeId);
    const checkInTime = dto.checkIn ? new Date(dto.checkIn) : new Date();
    const date = this.normalizeDate(checkInTime);

    const existing = await this.prisma.attendance.findUnique({
      where: {
        organizationId_employeeId_date: {
          organizationId,
          employeeId,
          date,
        },
      },
    });

    if (existing && existing.checkIn) {
      throw new ConflictException('Employee has already checked in for today.');
    }

    if (existing) {
      return this.prisma.attendance.update({
        where: {id: existing.id},
        data: {
          checkIn: checkInTime,
          status: AttendanceStatus.PRESENT,
          remarks: dto.remarks
            ? `${existing.remarks ? existing.remarks + '; ' : ''}${dto.remarks}`
            : existing.remarks,
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: true,
            },
          },
        },
      });
    }

    return this.prisma.attendance.create({
      data: {
        organizationId,
        employeeId,
        date,
        checkIn: checkInTime,
        status: AttendanceStatus.PRESENT,
        remarks: dto.remarks,
      },
      include: {
        employee: {
          select: {id: true, employeeCode: true, firstName: true, lastName: true, department: true},
        },
      },
    });
  }

  /**
   * Check out an employee
   */
  async checkOut(organizationId: string, userEmail: string, dto: CheckOutDto) {
    const employeeId = await this.resolveEmployeeId(organizationId, userEmail, dto.employeeId);
    const checkOutTime = dto.checkOut ? new Date(dto.checkOut) : new Date();
    const date = this.normalizeDate(checkOutTime);

    const record = await this.prisma.attendance.findUnique({
      where: {
        organizationId_employeeId_date: {
          organizationId,
          employeeId,
          date,
        },
      },
    });

    if (!record || !record.checkIn) {
      throw new BadRequestException('No active check-in record found for today to check out from.');
    }

    if (checkOutTime.getTime() < record.checkIn.getTime()) {
      throw new BadRequestException('Check-out time cannot be earlier than check-in time.');
    }

    const workingMinutes = this.calculateWorkingMinutes(record.checkIn, checkOutTime);

    // Auto-evaluate status if full day vs half day
    let status = record.status;
    if (status === AttendanceStatus.PRESENT && workingMinutes < 240) {
      status = AttendanceStatus.HALF_DAY;
    }

    return this.prisma.attendance.update({
      where: {id: record.id},
      data: {
        checkOut: checkOutTime,
        workingMinutes,
        status,
        remarks: dto.remarks
          ? `${record.remarks ? record.remarks + '; ' : ''}${dto.remarks}`
          : record.remarks,
      },
      include: {
        employee: {
          select: {id: true, employeeCode: true, firstName: true, lastName: true, department: true},
        },
      },
    });
  }

  /**
   * Manual attendance record creation (HR / Admin)
   */
  async create(organizationId: string, dto: CreateAttendanceDto) {
    const employeeId = await this.resolveEmployeeId(organizationId, undefined, dto.employeeId);
    const date = this.normalizeDate(dto.date);

    const existing = await this.prisma.attendance.findUnique({
      where: {
        organizationId_employeeId_date: {
          organizationId,
          employeeId,
          date,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Attendance record already exists for this employee on ${date.toISOString().slice(0, 10)}.`,
      );
    }

    const checkIn = dto.checkIn ? new Date(dto.checkIn) : null;
    const checkOut = dto.checkOut ? new Date(dto.checkOut) : null;

    let workingMinutes = dto.workingMinutes ?? 0;
    if (checkIn && checkOut && !dto.workingMinutes) {
      if (checkOut.getTime() < checkIn.getTime()) {
        throw new BadRequestException('Check-out time cannot be earlier than check-in time.');
      }
      workingMinutes = this.calculateWorkingMinutes(checkIn, checkOut);
    }

    let status = dto.status ?? AttendanceStatus.PRESENT;
    if (!dto.status && workingMinutes > 0 && workingMinutes < 240) {
      status = AttendanceStatus.HALF_DAY;
    }

    return this.prisma.attendance.create({
      data: {
        organizationId,
        employeeId,
        date,
        status,
        checkIn,
        checkOut,
        workingMinutes,
        remarks: dto.remarks,
      },
      include: {
        employee: {
          select: {id: true, employeeCode: true, firstName: true, lastName: true, department: true},
        },
      },
    });
  }

  /**
   * Find attendance records with filtering and pagination
   */
  async findAll(organizationId: string, query: AttendanceQueryDto) {
    const where: Prisma.AttendanceWhereInput = {
      organizationId,
    };

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.departmentId) {
      where.employee = {
        departmentId: query.departmentId,
      };
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.date) {
      where.date = this.normalizeDate(query.date);
    } else if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) {
        where.date.gte = this.normalizeDate(query.startDate);
      }
      if (query.endDate) {
        where.date.lte = this.normalizeDate(query.endDate);
      }
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      this.prisma.attendance.count({where}),
      this.prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              email: true,
              department: {
                select: {id: true, name: true, code: true},
              },
            },
          },
        },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Find single attendance record
   */
  async findOne(organizationId: string, id: string) {
    const attendance = await this.prisma.attendance.findFirst({
      where: {id, organizationId},
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            department: true,
          },
        },
      },
    });

    if (!attendance) {
      throw new NotFoundException(`Attendance record with ID '${id}' not found.`);
    }

    return attendance;
  }

  /**
   * Update / regularize attendance record
   */
  async update(organizationId: string, id: string, dto: UpdateAttendanceDto) {
    const existing = await this.findOne(organizationId, id);

    const checkIn =
      dto.checkIn !== undefined ? (dto.checkIn ? new Date(dto.checkIn) : null) : existing.checkIn;
    const checkOut =
      dto.checkOut !== undefined
        ? dto.checkOut
          ? new Date(dto.checkOut)
          : null
        : existing.checkOut;

    let workingMinutes = dto.workingMinutes ?? existing.workingMinutes ?? 0;
    if (checkIn && checkOut && dto.workingMinutes === undefined) {
      if (checkOut.getTime() < checkIn.getTime()) {
        throw new BadRequestException('Check-out time cannot be earlier than check-in time.');
      }
      workingMinutes = this.calculateWorkingMinutes(checkIn, checkOut);
    }

    return this.prisma.attendance.update({
      where: {id},
      data: {
        status: dto.status ?? existing.status,
        checkIn,
        checkOut,
        workingMinutes,
        remarks: dto.remarks !== undefined ? dto.remarks : existing.remarks,
      },
      include: {
        employee: {
          select: {id: true, employeeCode: true, firstName: true, lastName: true, department: true},
        },
      },
    });
  }

  /**
   * Delete attendance record
   */
  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    return this.prisma.attendance.delete({
      where: {id},
    });
  }

  /**
   * Attendance statistics & summary
   */
  async getSummary(organizationId: string, query: AttendanceQueryDto) {
    const where: Prisma.AttendanceWhereInput = {
      organizationId,
    };

    if (query.employeeId) {
      where.employeeId = query.employeeId;
    }

    if (query.departmentId) {
      where.employee = {departmentId: query.departmentId};
    }

    if (query.date) {
      where.date = this.normalizeDate(query.date);
    } else if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) {
        where.date.gte = this.normalizeDate(query.startDate);
      }
      if (query.endDate) {
        where.date.lte = this.normalizeDate(query.endDate);
      }
    }

    const records = await this.prisma.attendance.findMany({
      where,
      select: {
        status: true,
        workingMinutes: true,
      },
    });

    const summary = {
      totalRecords: records.length,
      present: 0,
      absent: 0,
      halfDay: 0,
      onLeave: 0,
      workFromHome: 0,
      holiday: 0,
      weekOff: 0,
      totalWorkingMinutes: 0,
      averageWorkingMinutes: 0,
    };

    for (const r of records) {
      const minutes = r.workingMinutes || 0;
      summary.totalWorkingMinutes += minutes;

      switch (r.status) {
        case AttendanceStatus.PRESENT:
          summary.present += 1;
          break;
        case AttendanceStatus.ABSENT:
          summary.absent += 1;
          break;
        case AttendanceStatus.HALF_DAY:
          summary.halfDay += 1;
          break;
        case AttendanceStatus.ON_LEAVE:
          summary.onLeave += 1;
          break;
        case AttendanceStatus.WORK_FROM_HOME:
          summary.workFromHome += 1;
          break;
        case AttendanceStatus.HOLIDAY:
          summary.holiday += 1;
          break;
        case AttendanceStatus.WEEK_OFF:
          summary.weekOff += 1;
          break;
      }
    }

    if (records.length > 0) {
      summary.averageWorkingMinutes = Math.round(summary.totalWorkingMinutes / records.length);
    }

    return summary;
  }
}
