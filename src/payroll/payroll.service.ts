import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

import {CreatePayrollPeriodDto} from './dto/create-payroll-period.dto';
import {CreatePayrollRunDto} from './dto/create-payroll-run.dto';

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // PAYROLL PERIODS
  // ============================================================

  async createPeriod(organizationId: string, dto: CreatePayrollPeriodDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (startDate >= endDate) {
      throw new BadRequestException('Start date must be before end date');
    }

    const existingPeriod = await this.prisma.payrollPeriod.findFirst({
      where: {
        organizationId,
        startDate,
        endDate,
      },
    });

    if (existingPeriod) {
      throw new BadRequestException('Payroll period already exists');
    }

    return this.prisma.payrollPeriod.create({
      data: {
        organizationId,
        name: dto.name,
        startDate,
        endDate,
      },
    });
  }

  async getPeriods(organizationId: string) {
    return this.prisma.payrollPeriod.findMany({
      where: {
        organizationId,
      },
      orderBy: {
        startDate: 'desc',
      },
    });
  }

  // ============================================================
  // PAYROLL RUNS
  // ============================================================

  async createRun(organizationId: string, dto: CreatePayrollRunDto, userId: string) {
    const payrollPeriod = await this.prisma.payrollPeriod.findFirst({
      where: {
        id: dto.payrollPeriodId,
        organizationId,
      },
    });

    if (!payrollPeriod) {
      throw new NotFoundException('Payroll period not found');
    }

    const existingRun = await this.prisma.payrollRun.findFirst({
      where: {
        organizationId,
        payrollPeriodId: payrollPeriod.id,
      },
    });

    if (existingRun) {
      throw new BadRequestException('Payroll run already exists for this period');
    }

    return this.prisma.$transaction(async tx => {
      const payrollRun = await tx.payrollRun.create({
        data: {
          organizationId,
          payrollPeriodId: payrollPeriod.id,
          status: 'DRAFT',
        },

        include: {
          payrollPeriod: true,
        },
      });

      await tx.payrollRunAudit.create({
        data: {
          payrollRunId: payrollRun.id,
          userId,
          action: 'CREATED',
        },
      });

      return payrollRun;
    });
  }

  async getRuns(organizationId: string) {
    return this.prisma.payrollRun.findMany({
      where: {
        organizationId,
      },
      include: {
        payrollPeriod: true,
        _count: {
          select: {
            payrollItems: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getRun(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      include: {
        payrollPeriod: true,

        payrollItems: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                departmentId: true,
                employmentType: true,
              },
            },
            components: true,
          },

          orderBy: {
            employee: {
              employeeCode: 'asc',
            },
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    return payrollRun;
  }

  // ============================================================
  // PAYROLL CALCULATION HELPERS
  // ============================================================

  private calculatePeriodDays(periodStart: Date, periodEnd: Date): number {
    const millisecondsPerDay = 1000 * 60 * 60 * 24;

    return Math.floor((periodEnd.getTime() - periodStart.getTime()) / millisecondsPerDay) + 1;
  }

  private calculatePayableDays(
    periodStart: Date,
    periodEnd: Date,
    joiningDate: Date,
    leavingDate?: Date | null,
  ): number {
    const effectiveStart = joiningDate > periodStart ? joiningDate : periodStart;

    const effectiveEnd = leavingDate && leavingDate < periodEnd ? leavingDate : periodEnd;

    if (effectiveStart > effectiveEnd) {
      return 0;
    }

    const millisecondsPerDay = 1000 * 60 * 60 * 24;

    return Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / millisecondsPerDay) + 1;
  }

  private roundMoney(amount: number): number {
    return Math.round((amount + Number.EPSILON) * 100) / 100;
  }

  private getCalculationBasis(
    basis: string | null,
    values: {
      basic: number;
      gross: number;
      fixedEarnings: number;
      totalEarnings: number;
    },
  ): number {
    switch (basis) {
      case 'BASIC':
        return values.basic;

      case 'GROSS':
        return values.gross;

      case 'FIXED_EARNINGS':
        return values.fixedEarnings;

      case 'TOTAL_EARNINGS':
        return values.totalEarnings;

      default:
        throw new BadRequestException(
          'Percentage salary component requires a valid calculation basis',
        );
    }
  }

  private calculatePercentageAmount(percentage: number, basisAmount: number): number {
    return this.roundMoney((basisAmount * percentage) / 100);
  }

  // ============================================================
  // PROCESS PAYROLL
  // ============================================================

  async processRun(organizationId: string, payrollRunId: string, userId: string) {
    /*
     * ==========================================================
     * 1. Find payroll run
     * ==========================================================
     */

    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      include: {
        payrollPeriod: true,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    /*
     * ==========================================================
     * 2. Validate status
     * ==========================================================
     */

    if (payrollRun.status !== 'DRAFT') {
      throw new BadRequestException(
        `Payroll run cannot be processed from ${payrollRun.status} status`,
      );
    }

    /*
     * ==========================================================
     * 3. Atomically claim the payroll run
     *
     * Only ONE request can change DRAFT → PROCESSING.
     * ==========================================================
     */

    const claimResult = await this.prisma.payrollRun.updateMany({
      where: {
        id: payrollRunId,
        organizationId,
        status: 'DRAFT',
      },

      data: {
        status: 'PROCESSING',
      },
    });

    if (claimResult.count !== 1) {
      throw new BadRequestException(
        'Payroll run is already being processed or is no longer in DRAFT status',
      );
    }

    /*
     * ==========================================================
     * 4. Process payroll inside a transaction
     * ==========================================================
     */

    try {
      const result = await this.prisma.$transaction(async tx => {
        /*
         * ------------------------------------------------------
         * Find active employees
         * ------------------------------------------------------
         */

        const employees = await tx.employee.findMany({
          where: {
            organizationId,

            employmentStatus: 'ACTIVE',

            dateOfJoining: {
              lte: payrollRun.payrollPeriod.endDate,
            },

            OR: [
              {
                dateOfLeaving: null,
              },
              {
                dateOfLeaving: {
                  gte: payrollRun.payrollPeriod.startDate,
                },
              },
            ],
          },

          include: {
            salaryStructures: {
              where: {
                effectiveFrom: {
                  lte: payrollRun.payrollPeriod.endDate,
                },

                OR: [
                  {
                    effectiveTo: null,
                  },
                  {
                    effectiveTo: {
                      gte: payrollRun.payrollPeriod.startDate,
                    },
                  },
                ],
              },

              include: {
                components: true,
              },

              orderBy: {
                effectiveFrom: 'desc',
              },
            },
          },
        });

        /*
         * ------------------------------------------------------
         * Validate employees
         * ------------------------------------------------------
         */

        if (employees.length === 0) {
          throw new BadRequestException('No active employees found for this organization');
        }

        /*
         * ------------------------------------------------------
         * Payroll period calculations
         * ------------------------------------------------------
         */

        const periodStart = payrollRun.payrollPeriod.startDate;

        const periodEnd = payrollRun.payrollPeriod.endDate;

        const periodDays = this.calculatePeriodDays(periodStart, periodEnd);

        /*
         * ------------------------------------------------------
         * Process every employee
         * ------------------------------------------------------
         */

        for (const employee of employees) {
          /*
           * Find applicable salary structure
           */

          const salaryStructure = employee.salaryStructures[0];

          if (!salaryStructure) {
            throw new BadRequestException(
              `No salary structure found for employee ${employee.employeeCode}`,
            );
          }

          /*
           * Calculate eligible calendar days (tenure within period)
           */

          const eligibleDays = this.calculatePayableDays(
            periodStart,
            periodEnd,
            employee.dateOfJoining,
            employee.dateOfLeaving,
          );

          if (eligibleDays <= 0) {
            continue;
          }

          /*
           * Query actual attendance records for this employee within the period
           */
          const attendances = await tx.attendance.findMany({
            where: {
              organizationId,
              employeeId: employee.id,
              date: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
          });

          let lopDays = 0;
          for (const att of attendances) {
            if (att.status === 'ABSENT') {
              lopDays += 1;
            } else if (att.status === 'HALF_DAY') {
              lopDays += 0.5;
            }
          }

          const payableDays = Math.max(0, eligibleDays - lopDays);

          // ------------------------------------------------
          // Calculate proration
          // ------------------------------------------------

          const prorationFactor = payableDays / periodDays;

          // ------------------------------------------------
          // Separate salary components
          // ------------------------------------------------

          const fixedEarningComponents = salaryStructure.components.filter(
            component => component.type === 'EARNING' && component.calculationType === 'FIXED',
          );

          const percentageEarningComponents = salaryStructure.components.filter(
            component => component.type === 'EARNING' && component.calculationType === 'PERCENTAGE',
          );

          const deductionComponents = salaryStructure.components.filter(
            component => component.type === 'DEDUCTION',
          );

          // ------------------------------------------------
          // Basic salary
          // ------------------------------------------------

          const basicComponent = fixedEarningComponents.find(
            component => component.name.trim().toLowerCase() === 'basic',
          );

          const basicSalary = basicComponent
            ? this.roundMoney(Number(basicComponent.amount) * prorationFactor)
            : 0;

          // ------------------------------------------------
          // Fixed earnings
          // ------------------------------------------------

          const fixedEarnings = this.roundMoney(
            fixedEarningComponents.reduce(
              (total, component) => total + Number(component.amount) * prorationFactor,
              0,
            ),
          );

          // ------------------------------------------------
          // Percentage earnings
          // ------------------------------------------------

          let percentageEarnings = 0;

          for (const component of percentageEarningComponents) {
            const basisAmount = this.getCalculationBasis(component.calculationBasis, {
              basic: basicSalary,
              gross: 0,
              fixedEarnings,
              totalEarnings: fixedEarnings,
            });

            percentageEarnings += this.calculatePercentageAmount(
              Number(component.amount),
              basisAmount,
            );
          }

          percentageEarnings = this.roundMoney(percentageEarnings);

          // ------------------------------------------------
          // Total earnings
          // ------------------------------------------------

          const totalEarnings = this.roundMoney(fixedEarnings + percentageEarnings);

          // ------------------------------------------------
          // Gross salary
          // ------------------------------------------------

          const grossSalary = totalEarnings;

          // ------------------------------------------------
          // Deductions
          // ------------------------------------------------

          let totalDeductions = 0;

          for (const component of deductionComponents) {
            let amount = 0;

            if (component.calculationType === 'FIXED') {
              amount = Number(component.amount) * prorationFactor;
            } else {
              const basisAmount = this.getCalculationBasis(component.calculationBasis, {
                basic: basicSalary,
                gross: grossSalary,
                fixedEarnings,
                totalEarnings,
              });

              amount = this.calculatePercentageAmount(Number(component.amount), basisAmount);
            }

            totalDeductions += amount;
          }

          totalDeductions = this.roundMoney(totalDeductions);

          // ------------------------------------------------
          // Net salary
          // ------------------------------------------------

          const netSalary = this.roundMoney(grossSalary - totalDeductions);

          /*
           * ----------------------------------------------------
           * Create PayrollItem
           *
           * The database unique constraint:
           *
           * @@unique([payrollRunId, employeeId])
           *
           * gives us an additional safety net.
           * ----------------------------------------------------
           */

          await tx.payrollItem.create({
            data: {
              payrollRunId: payrollRun.id,
              employeeId: employee.id,

              grossSalary,
              totalEarnings,
              totalDeductions,
              netSalary,

              totalDays: periodDays,
              payableDays,
              lopDays,

              components: {
                create: salaryStructure.components.map(component => {
                  let amount = 0;

                  if (component.calculationType === 'FIXED') {
                    amount = Number(component.amount) * prorationFactor;
                  } else {
                    amount = (fixedEarnings * Number(component.amount)) / 100;
                  }
                  amount = this.roundMoney(amount);

                  return {
                    name: component.name,
                    type: component.type,
                    calculationType: component.calculationType,
                    amount,
                  };
                }),
              },
            },
          });
        }

        /*
         * ------------------------------------------------------
         * Mark payroll as PROCESSED
         * ------------------------------------------------------
         */

        const updatedRun = await tx.payrollRun.update({
          where: {
            id: payrollRun.id,
          },

          data: {
            status: 'PROCESSED',
            processedAt: new Date(),
          },
        });

        /*
         * ------------------------------------------------------
         * Audit
         * ------------------------------------------------------
         */

        await tx.payrollRunAudit.create({
          data: {
            payrollRunId: payrollRun.id,
            userId,
            action: 'PROCESSED',
          },
        });

        return updatedRun;
      });

      /*
       * ========================================================
       * Return processed payroll
       * ========================================================
       */

      return this.prisma.payrollRun.findUnique({
        where: {
          id: result.id,
        },

        include: {
          payrollPeriod: true,

          payrollItems: {
            include: {
              employee: true,
              components: true,
            },
          },
        },
      });
    } catch (error) {
      /*
       * ========================================================
       * Processing failed
       *
       * Return run to DRAFT so it can be corrected/reprocessed.
       *
       * IMPORTANT:
       * Only reset if it is still PROCESSING.
       * ========================================================
       */

      await this.prisma.payrollRun.updateMany({
        where: {
          id: payrollRun.id,
          organizationId,
          status: 'PROCESSING',
        },

        data: {
          status: 'DRAFT',
        },
      });

      throw error;
    }
  }

  async approve(organizationId: string, payrollRunId: string, userId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    if (payrollRun.status !== 'PROCESSED') {
      throw new BadRequestException(
        `Payroll run cannot be approved from ${payrollRun.status} status`,
      );
    }

    /*
     * ==========================================================
     * Atomically transition:
     *
     * PROCESSED → APPROVED
     *
     * Only one request can succeed.
     * ==========================================================
     */

    const claimResult = await this.prisma.payrollRun.updateMany({
      where: {
        id: payrollRunId,
        organizationId,
        status: 'PROCESSED',
      },

      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: userId,
      },
    });

    if (claimResult.count !== 1) {
      throw new BadRequestException(
        'Payroll run has already been approved or is no longer in PROCESSED status',
      );
    }

    /*
     * ==========================================================
     * Audit
     * ==========================================================
     */

    await this.prisma.payrollRunAudit.create({
      data: {
        payrollRunId,
        userId,
        action: 'APPROVED',
      },
    });

    /*
     * ==========================================================
     * Return updated payroll run
     * ==========================================================
     */

    return this.prisma.payrollRun.findUnique({
      where: {
        id: payrollRunId,
      },

      include: {
        payrollPeriod: true,

        payrollItems: {
          include: {
            employee: true,
          },
        },

        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async cancel(organizationId: string, payrollRunId: string, userId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    const allowedStatuses = ['DRAFT', 'PROCESSED'];

    if (!allowedStatuses.includes(payrollRun.status)) {
      throw new BadRequestException(
        `Payroll run cannot be cancelled from ${payrollRun.status} status`,
      );
    }

    return this.prisma.$transaction(async tx => {
      const updatedRun = await tx.payrollRun.update({
        where: {
          id: payrollRun.id,
        },

        data: {
          status: 'CANCELLED',
        },

        include: {
          payrollPeriod: true,

          payrollItems: {
            include: {
              employee: true,
            },
          },
        },
      });

      await tx.payrollRunAudit.create({
        data: {
          payrollRunId: payrollRun.id,
          userId,
          action: 'CANCELLED',
        },
      });

      return updatedRun;
    });
  }
  async getAudits(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    return this.prisma.payrollRunAudit.findMany({
      where: {
        payrollRunId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async markAsPaid(
    organizationId: string,
    payrollRunId: string,
    userId: string,
    paymentReference?: string,
  ) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    if (payrollRun.status !== 'APPROVED') {
      throw new BadRequestException(
        `Payroll run cannot be marked as paid from ${payrollRun.status} status`,
      );
    }

    /*
     * ==========================================================
     * Atomically transition:
     *
     * APPROVED → PAID
     *
     * Only one request can succeed.
     * ==========================================================
     */

    const claimResult = await this.prisma.payrollRun.updateMany({
      where: {
        id: payrollRunId,
        organizationId,
        status: 'APPROVED',
      },

      data: {
        status: 'PAID',
        paidAt: new Date(),
        paidById: userId,
        paymentReference: paymentReference ?? null,
      },
    });

    if (claimResult.count !== 1) {
      throw new BadRequestException(
        'Payroll run has already been paid or is no longer in APPROVED status',
      );
    }

    /*
     * ==========================================================
     * Audit
     * ==========================================================
     */

    await this.prisma.payrollRunAudit.create({
      data: {
        payrollRunId,
        userId,
        action: 'PAID',
      },
    });

    /*
     * ==========================================================
     * Return updated payroll run
     * ==========================================================
     */

    return this.prisma.payrollRun.findUnique({
      where: {
        id: payrollRunId,
      },

      include: {
        payrollPeriod: true,

        payrollItems: {
          include: {
            employee: true,
          },
        },

        approvedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },

        paidBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async getRunHistory(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        processedAt: true,
        approvedAt: true,
        paidAt: true,
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    const audits = await this.prisma.payrollRunAudit.findMany({
      where: {
        payrollRunId,
      },

      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },

      orderBy: {
        createdAt: 'asc',
      },
    });

    return audits.map(audit => ({
      action: audit.action,

      performedAt: audit.createdAt,

      performedBy: {
        id: audit.user.id,
        name: `${audit.user.firstName} ${audit.user.lastName}`,
        email: audit.user.email,
      },
    }));
  }

  async getPayrollSummary(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      include: {
        payrollPeriod: true,
        payrollItems: {
          select: {
            grossSalary: true,
            totalEarnings: true,
            totalDeductions: true,
            netSalary: true,
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    const summary = payrollRun.payrollItems.reduce(
      (acc, item) => {
        acc.totalGross += Number(item.grossSalary);
        acc.totalEarnings += Number(item.totalEarnings);
        acc.totalDeductions += Number(item.totalDeductions);
        acc.totalNet += Number(item.netSalary);

        return acc;
      },
      {
        totalGross: 0,
        totalEarnings: 0,
        totalDeductions: 0,
        totalNet: 0,
      },
    );

    return {
      payrollRunId: payrollRun.id,
      status: payrollRun.status,

      payrollPeriod: {
        id: payrollRun.payrollPeriod.id,
        name: payrollRun.payrollPeriod.name,
        startDate: payrollRun.payrollPeriod.startDate,
        endDate: payrollRun.payrollPeriod.endDate,
      },

      employeeCount: payrollRun.payrollItems.length,

      ...summary,
    };
  }
  async getPayrollEmployeeReport(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      include: {
        payrollPeriod: true,

        payrollItems: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                email: true,
                department: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
                employmentType: true,
                employmentStatus: true,
              },
            },

            components: {
              select: {
                id: true,
                name: true,
                type: true,
                calculationType: true,
                amount: true,
              },
            },
          },

          orderBy: {
            employee: {
              employeeCode: 'asc',
            },
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    return {
      payrollRunId: payrollRun.id,
      status: payrollRun.status,

      payrollPeriod: {
        id: payrollRun.payrollPeriod.id,
        name: payrollRun.payrollPeriod.name,
        startDate: payrollRun.payrollPeriod.startDate,
        endDate: payrollRun.payrollPeriod.endDate,
      },

      employees: payrollRun.payrollItems.map(item => ({
        payrollItemId: item.id,

        employee: {
          id: item.employee.id,
          employeeCode: item.employee.employeeCode,
          firstName: item.employee.firstName,
          lastName: item.employee.lastName,
          email: item.employee.email,
          employmentType: item.employee.employmentType,
          employmentStatus: item.employee.employmentStatus,

          department: item.employee.department
            ? {
                id: item.employee.department.id,
                name: item.employee.department.name,
                code: item.employee.department.code,
              }
            : null,
        },

        grossSalary: Number(item.grossSalary),
        totalEarnings: Number(item.totalEarnings),
        totalDeductions: Number(item.totalDeductions),
        netSalary: Number(item.netSalary),

        totalDays: item.totalDays,
        payableDays: Number(item.payableDays),
        lopDays: Number(item.lopDays),

        components: item.components.map(component => ({
          id: component.id,
          name: component.name,
          type: component.type,
          calculationType: component.calculationType,
          amount: Number(component.amount),
        })),
      })),
    };
  }

  async exportPayrollRun(organizationId: string, payrollRunId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
      },
      include: {
        payrollPeriod: true,

        payrollItems: {
          include: {
            employee: {
              select: {
                employeeCode: true,
                firstName: true,
                lastName: true,
                department: {
                  select: {
                    name: true,
                  },
                },
              },
            },

            components: {
              select: {
                name: true,
                type: true,
                amount: true,
              },
            },
          },

          orderBy: {
            employee: {
              employeeCode: 'asc',
            },
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Payroll run not found');
    }

    const workbook = new ExcelJS.Workbook();

    const worksheet = workbook.addWorksheet('Payroll');

    worksheet.columns = [
      {
        header: 'Employee Code',
        key: 'employeeCode',
        width: 18,
      },
      {
        header: 'Employee Name',
        key: 'employeeName',
        width: 25,
      },
      {
        header: 'Department',
        key: 'department',
        width: 20,
      },
      {
        header: 'Total Days',
        key: 'totalDays',
        width: 14,
      },
      {
        header: 'Payable Days',
        key: 'payableDays',
        width: 14,
      },
      {
        header: 'LOP Days',
        key: 'lopDays',
        width: 14,
      },
      {
        header: 'Gross Salary',
        key: 'grossSalary',
        width: 18,
      },
      {
        header: 'Total Earnings',
        key: 'totalEarnings',
        width: 18,
      },
      {
        header: 'Total Deductions',
        key: 'totalDeductions',
        width: 20,
      },
      {
        header: 'Net Salary',
        key: 'netSalary',
        width: 18,
      },
    ];

    for (const item of payrollRun.payrollItems) {
      worksheet.addRow({
        employeeCode: item.employee.employeeCode,

        employeeName: `${item.employee.firstName} ${item.employee.lastName}`.trim(),

        department: item.employee.department?.name ?? '',

        totalDays: item.totalDays,

        payableDays: Number(item.payableDays),

        lopDays: Number(item.lopDays),

        grossSalary: Number(item.grossSalary),

        totalEarnings: Number(item.totalEarnings),

        totalDeductions: Number(item.totalDeductions),

        netSalary: Number(item.netSalary),
      });
    }

    // Format currency columns
    ['grossSalary', 'totalEarnings', 'totalDeductions', 'netSalary'].forEach(key => {
      worksheet.getColumn(key).numFmt = '#,##0.00';
    });

    // Freeze header
    worksheet.views = [
      {
        state: 'frozen',
        ySplit: 1,
      },
    ];

    // Make header bold
    worksheet.getRow(1).font = {
      bold: true,
    };

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      fileName: `payroll-${payrollRunId}.xlsx`,
      buffer: Buffer.from(buffer),
    };
  }

  async generatePayslip(organizationId: string, payrollRunId: string, employeeId: string) {
    const payrollRun = await this.prisma.payrollRun.findFirst({
      where: {
        id: payrollRunId,
        organizationId,
        status: {
          in: ['APPROVED', 'PAID'],
        },
      },
      include: {
        organization: {
          select: {
            name: true,
          },
        },

        payrollPeriod: true,

        payrollItems: {
          where: {
            employeeId,
          },

          include: {
            employee: {
              include: {
                department: {
                  select: {
                    name: true,
                  },
                },
              },
            },

            components: {
              orderBy: {
                type: 'asc',
              },
            },
          },
        },
      },
    });

    if (!payrollRun) {
      throw new NotFoundException('Approved or paid payroll run not found');
    }

    const payrollItem = payrollRun.payrollItems[0];

    if (!payrollItem) {
      throw new NotFoundException('Payroll item not found for this employee');
    }

    const employee = payrollItem.employee;

    /*
     * PDF DOCUMENT
     */

    const doc = new PDFDocument({
      size: 'A4',
      margins: {top: 40, bottom: 25, left: 45, right: 45},
    });

    const chunks: Buffer[] = [];

    doc.on('data', chunk => chunks.push(chunk));

    /*
     * CONSTANTS & GEOMETRY (A4: 595.28 x 841.89 pt)
     */

    const pageLeft = 45;
    const pageRight = 550;
    const pageWidth = pageRight - pageLeft; // 505 pt

    const formatAmount = (amount: any) =>
      `INR ${Number(amount || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

    const formatDate = (date: Date | string | null) => {
      if (!date) return 'N/A';
      const d = new Date(date);
      return isNaN(d.getTime())
        ? 'N/A'
        : d.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          });
    };

    const drawHorizontalLine = (lineY: number, color = '#e2e8f0', lineWidth = 0.6) => {
      doc
        .strokeColor(color)
        .lineWidth(lineWidth)
        .moveTo(pageLeft, lineY)
        .lineTo(pageRight, lineY)
        .stroke();
    };

    /*
     * DATA
     */

    const earnings = payrollItem.components.filter(c => c.type === 'EARNING');
    const deductions = payrollItem.components.filter(c => c.type === 'DEDUCTION');

    let y = 45;

    /*
     * =========================================================
     * 1. HEADER / LETTERHEAD
     * =========================================================
     */

    // Left: Company Name & Statement Title
    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#0f172a')
      .text(payrollRun.organization.name, pageLeft, y, {
        width: 320,
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#64748b')
      .text('CONFIDENTIAL SALARY STATEMENT', pageLeft, y + 22, {
        characterSpacing: 0.5,
      });

    // Right: Pay Period & Status Pill
    const periodName = payrollRun.payrollPeriod.name.toUpperCase();
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#0f172a')
      .text(periodName, 320, y, {
        width: pageWidth - (320 - pageLeft),
        align: 'right',
      });

    const periodRange = `${formatDate(payrollRun.payrollPeriod.startDate)} — ${formatDate(payrollRun.payrollPeriod.endDate)}`;
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#64748b')
      .text(periodRange, 320, y + 17, {
        width: pageWidth - (320 - pageLeft),
        align: 'right',
      });

    const isPaid = payrollRun.status === 'PAID';
    const statusText = isPaid ? 'DISBURSED' : payrollRun.status;
    const statusWidth = 64;
    const statusHeight = 14;
    const statusX = pageRight - statusWidth;
    const statusY = y + 31;
    doc
      .roundedRect(statusX, statusY, statusWidth, statusHeight, 3)
      .fill(isPaid ? '#ecfdf5' : '#f1f5f9');
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(isPaid ? '#047857' : '#475569')
      .text(statusText, statusX, statusY + 3.5, {
        width: statusWidth,
        align: 'center',
      });

    y += 54;
    drawHorizontalLine(y, '#cbd5e1', 0.8);
    y += 14;

    /*
     * =========================================================
     * 2. EMPLOYEE INFORMATION GRID
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#334155')
      .text('EMPLOYEE SUMMARY', pageLeft, y, {
        characterSpacing: 0.5,
      });
    y += 12;

    const empCardTop = y;
    const empCardHeight = 68;
    doc
      .roundedRect(pageLeft, empCardTop, pageWidth, empCardHeight, 4)
      .fillAndStroke('#f8fafc', '#e2e8f0');

    const colWidth = pageWidth / 4;
    const row1Y = empCardTop + 10;
    const row2Y = empCardTop + 38;

    const renderInfoCell = (label: string, val: string, colIndex: number, currentY: number) => {
      const cellX = pageLeft + 12 + colIndex * colWidth;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748b')
        .text(label.toUpperCase(), cellX, currentY, {
          characterSpacing: 0.3,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#0f172a')
        .text(val, cellX, currentY + 12, {
          width: colWidth - 16,
          ellipsis: true,
        });
    };

    renderInfoCell('Employee ID', employee.employeeCode, 0, row1Y);
    renderInfoCell('Full Name', `${employee.firstName} ${employee.lastName}`.trim(), 1, row1Y);
    renderInfoCell('Department', employee.department?.name || 'General', 2, row1Y);
    renderInfoCell('Employment Type', employee.employmentType, 3, row1Y);

    renderInfoCell('Total Days', `${payrollItem.totalDays || 30} Days`, 0, row2Y);
    renderInfoCell(
      'Payable Days',
      `${Number(payrollItem.payableDays || 0).toFixed(1)} Days`,
      1,
      row2Y,
    );
    renderInfoCell(
      'Loss of Pay (LOP)',
      `${Number(payrollItem.lopDays || 0).toFixed(1)} Days`,
      2,
      row2Y,
    );
    renderInfoCell('Disbursement', isPaid ? 'Paid' : 'Processed', 3, row2Y);

    y = empCardTop + empCardHeight + 16;

    /*
     * =========================================================
     * 3. EARNINGS & DEDUCTIONS BREAKDOWN TABLE
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#334155')
      .text('SALARY BREAKDOWN', pageLeft, y, {
        characterSpacing: 0.5,
      });
    y += 12;

    const tableTop = y;
    const halfWidth = pageWidth / 2; // 252.5 pt
    const leftCol = pageLeft;
    const rightCol = pageLeft + halfWidth;
    const middleX = rightCol;

    const headerHeight = 22;
    const rowHeight = 19;
    const maxRows = Math.max(earnings.length, deductions.length, 1);
    const totalRowHeight = 24;
    const tableHeight = headerHeight + maxRows * rowHeight + totalRowHeight;

    // Outer table container
    doc
      .roundedRect(pageLeft, tableTop, pageWidth, tableHeight, 4)
      .fillAndStroke('#ffffff', '#e2e8f0');

    // Header Background
    doc.roundedRect(pageLeft, tableTop, pageWidth, headerHeight, 4).fill('#f1f5f9');
    doc.rect(pageLeft, tableTop + headerHeight - 4, pageWidth, 4).fill('#f1f5f9'); // square bottom of header

    // Header Titles
    // Left: Earnings
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#334155')
      .text('EARNINGS', leftCol + 10, tableTop + 7);
    doc.text('AMOUNT (INR)', leftCol + 10, tableTop + 7, {
      width: halfWidth - 20,
      align: 'right',
    });

    // Right: Deductions
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#334155')
      .text('DEDUCTIONS', rightCol + 10, tableTop + 7);
    doc.text('AMOUNT (INR)', rightCol + 10, tableTop + 7, {
      width: halfWidth - 20,
      align: 'right',
    });

    // Dividers
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.6)
      .moveTo(middleX, tableTop)
      .lineTo(middleX, tableTop + tableHeight)
      .stroke();
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.6)
      .moveTo(pageLeft, tableTop + headerHeight)
      .lineTo(pageRight, tableTop + headerHeight)
      .stroke();

    // Component rows
    let currentRowY = tableTop + headerHeight;
    for (let i = 0; i < maxRows; i++) {
      const earning = earnings[i];
      const deduction = deductions[i];

      if (i > 0) {
        doc
          .strokeColor('#f8fafc')
          .lineWidth(0.5)
          .moveTo(pageLeft, currentRowY)
          .lineTo(pageRight, currentRowY)
          .stroke();
      }

      if (earning) {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#1e293b')
          .text(earning.name, leftCol + 10, currentRowY + 5.5, {
            width: halfWidth - 100,
            ellipsis: true,
          });
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#0f172a')
          .text(formatAmount(earning.amount).replace('INR ', ''), leftCol + 10, currentRowY + 5.5, {
            width: halfWidth - 20,
            align: 'right',
          });
      }

      if (deduction) {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#1e293b')
          .text(deduction.name, rightCol + 10, currentRowY + 5.5, {
            width: halfWidth - 100,
            ellipsis: true,
          });
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#0f172a')
          .text(
            formatAmount(deduction.amount).replace('INR ', ''),
            rightCol + 10,
            currentRowY + 5.5,
            {
              width: halfWidth - 20,
              align: 'right',
            },
          );
      }

      currentRowY += rowHeight;
    }

    // Totals Row
    const totalsY = tableTop + headerHeight + maxRows * rowHeight;
    doc.roundedRect(pageLeft, totalsY, pageWidth, totalRowHeight, 4).fill('#f8fafc');
    doc.rect(pageLeft, totalsY, pageWidth, 4).fill('#f8fafc'); // square top
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.6)
      .moveTo(pageLeft, totalsY)
      .lineTo(pageRight, totalsY)
      .stroke();
    doc
      .strokeColor('#e2e8f0')
      .lineWidth(0.6)
      .moveTo(middleX, totalsY)
      .lineTo(middleX, totalsY + totalRowHeight)
      .stroke();

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#0f172a')
      .text('TOTAL GROSS EARNINGS', leftCol + 10, totalsY + 7);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#0f172a')
      .text(formatAmount(payrollItem.totalEarnings), leftCol + 10, totalsY + 7, {
        width: halfWidth - 20,
        align: 'right',
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#0f172a')
      .text('TOTAL DEDUCTIONS', rightCol + 10, totalsY + 7);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#0f172a')
      .text(formatAmount(payrollItem.totalDeductions), rightCol + 10, totalsY + 7, {
        width: halfWidth - 20,
        align: 'right',
      });

    y = tableTop + tableHeight + 14;

    /*
     * =========================================================
     * 4. NET TAKE-HOME PAY HIGHLIGHT BANNER
     * =========================================================
     */

    const netBannerTop = y;
    const netBannerHeight = 48;
    doc
      .roundedRect(pageLeft, netBannerTop, pageWidth, netBannerHeight, 5)
      .fillAndStroke('#ecfdf5', '#a7f3d0');

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#065f46')
      .text('NET TAKE-HOME SALARY', pageLeft + 14, netBannerTop + 12, {
        characterSpacing: 0.5,
      });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#047857')
      .text('Total Net Amount Credited into Employee Account', pageLeft + 14, netBannerTop + 27);

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#065f46')
      .text(formatAmount(payrollItem.netSalary), pageLeft + 14, netBannerTop + 14, {
        width: pageWidth - 28,
        align: 'right',
      });

    y = netBannerTop + netBannerHeight + 14;

    /*
     * =========================================================
     * 5. PAYMENT & COMPLIANCE METADATA
     * =========================================================
     */

    const payCardTop = y;
    const payCardHeight = 44;
    doc
      .roundedRect(pageLeft, payCardTop, pageWidth, payCardHeight, 4)
      .fillAndStroke('#f8fafc', '#e2e8f0');

    const thirdWidth = pageWidth / 3;
    const payRowY = payCardTop + 9;

    const renderPayCell = (label: string, val: string, index: number) => {
      const cellX = pageLeft + 12 + index * thirdWidth;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748b')
        .text(label.toUpperCase(), cellX, payRowY, {
          characterSpacing: 0.3,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .fillColor('#0f172a')
        .text(val, cellX, payRowY + 12, {
          width: thirdWidth - 16,
          ellipsis: true,
        });
    };

    renderPayCell('Disbursement Status', isPaid ? 'Completed (Paid)' : payrollRun.status, 0);
    renderPayCell('Payment Date', formatDate(payrollRun.paidAt), 1);
    renderPayCell(
      'Payment Reference',
      payrollRun.paymentReference || 'Bank Transfer / Direct Deposit',
      2,
    );

    /*
     * =========================================================
     * 6. FOOTER & DISCLAIMER
     * =========================================================
     */

    const footerY = 755;
    drawHorizontalLine(footerY, '#e2e8f0', 0.6);

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#94a3b8')
      .text(
        'This document is an electronically generated salary slip and does not require an ink signature.',
        pageLeft,
        footerY + 10,
        {
          width: pageWidth,
          align: 'center',
          lineBreak: false,
        },
      );

    const nowFormatted = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#94a3b8')
      .text(
        `${payrollRun.organization.name} · Verified Payroll Processing System · Generated on ${nowFormatted}`,
        pageLeft,
        footerY + 22,
        {
          width: pageWidth,
          align: 'center',
          lineBreak: false,
        },
      );

    /*
     * END DOCUMENT
     */

    doc.end();

    await new Promise<void>(resolve => {
      doc.on('end', resolve);
    });

    return {
      fileName: `payslip-${employee.employeeCode}-${payrollRun.payrollPeriod.name}.pdf`,
      buffer: Buffer.concat(chunks),
    };
  }

  // Add to src/payroll/payroll.service.ts

  async aggregatePayrollData(
    organizationId: string,
    filters: {status?: string; departmentName?: string},
  ) {
    const whereClause: any = {
      payrollRun: {
        organizationId,
      },
    };

    if (filters.status) {
      whereClause.payrollRun.status = filters.status;
    }

    if (filters.departmentName) {
      whereClause.employee = {
        department: {name: filters.departmentName},
      };
    }

    const aggregations = await this.prisma.payrollItem.aggregate({
      where: whereClause,
      _sum: {
        grossSalary: true,
        totalEarnings: true,
        totalDeductions: true,
        netSalary: true,
      },
      _count: {
        employeeId: true,
      },
    });

    return {
      totalEmployeesPaid: aggregations._count.employeeId,
      totalGross: Number(aggregations._sum.grossSalary || 0),
      totalNet: Number(aggregations._sum.netSalary || 0),
      totalDeductions: Number(aggregations._sum.totalDeductions || 0),
    };
  }

  async getMyPayslips(organizationId: string, email: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {organizationId, email},
    });

    if (!employee) {
      throw new NotFoundException(`No employee profile found for user '${email}'.`);
    }

    const items = await this.prisma.payrollItem.findMany({
      where: {
        employeeId: employee.id,
        payrollRun: {
          organizationId,
          status: {
            in: ['APPROVED', 'PAID'],
          },
        },
      },
      include: {
        payrollRun: {
          include: {
            payrollPeriod: true,
          },
        },
        components: true,
      },
      orderBy: {
        payrollRun: {
          payrollPeriod: {
            startDate: 'desc',
          },
        },
      },
    });

    return items.map(item => ({
      id: item.id,
      payrollRunId: item.payrollRunId,
      periodName: item.payrollRun.payrollPeriod.name,
      startDate: item.payrollRun.payrollPeriod.startDate,
      endDate: item.payrollRun.payrollPeriod.endDate,
      status: item.payrollRun.status,
      grossSalary: Number(item.grossSalary),
      totalEarnings: Number(item.totalEarnings),
      totalDeductions: Number(item.totalDeductions),
      netSalary: Number(item.netSalary),
      totalDays: item.totalDays,
      payableDays: Number(item.payableDays),
      lopDays: Number(item.lopDays),
      components: item.components.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        calculationType: c.calculationType,
        amount: Number(c.amount),
      })),
    }));
  }

  async generateMyPayslip(organizationId: string, email: string, payrollRunId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: {organizationId, email},
    });

    if (!employee) {
      throw new NotFoundException(`No employee profile found for user '${email}'.`);
    }

    return this.generatePayslip(organizationId, payrollRunId, employee.id);
  }
}
