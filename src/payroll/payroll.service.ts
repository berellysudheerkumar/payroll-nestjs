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
           * Calculate payable days
           */

          const payableDays = this.calculatePayableDays(
            periodStart,
            periodEnd,
            employee.dateOfJoining,
            employee.dateOfLeaving,
          );

          if (payableDays <= 0) {
            continue;
          }

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
      margin: 40,
    });

    const chunks: Buffer[] = [];

    doc.on('data', chunk => chunks.push(chunk));

    /*
     * CONSTANTS
     */

    const pageLeft = 50;
    const pageRight = 545;
    const pageWidth = pageRight - pageLeft;

    const leftColumn = 50;
    const rightColumn = 305;
    const columnWidth = 240;

    /*
     * HELPERS
     */

    const formatAmount = (amount: any) =>
      `₹${Number(amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

    const formatDate = (date: Date | null) =>
      date
        ? date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : 'N/A';

    const drawHorizontalLine = (y: number, color = '#e5e7eb') => {
      doc.strokeColor(color).lineWidth(0.7).moveTo(pageLeft, y).lineTo(pageRight, y).stroke();
    };

    const drawLabelValue = (label: string, value: string, x: number, y: number, valueX: number) => {
      doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text(label, x, y);

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(value, valueX, y);
    };

    /*
     * DATA
     */

    const earnings = payrollItem.components.filter(component => component.type === 'EARNING');

    const deductions = payrollItem.components.filter(component => component.type === 'DEDUCTION');

    let y = 45;

    /*
     * =========================================================
     * HEADER
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(21)
      .fillColor('#111827')
      .text(payrollRun.organization.name, pageLeft, y, {
        width: pageWidth,
        align: 'center',
      });

    y += 30;

    doc.font('Helvetica-Bold').fontSize(15).fillColor('#374151').text('SALARY SLIP', pageLeft, y, {
      width: pageWidth,
      align: 'center',
    });

    y += 22;

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text(payrollRun.payrollPeriod.name, pageLeft, y, {
        width: pageWidth,
        align: 'center',
      });

    y += 25;

    drawHorizontalLine(y, '#d1d5db');

    y += 25;

    /*
     * =========================================================
     * EMPLOYEE INFORMATION
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text('EMPLOYEE INFORMATION', pageLeft, y);

    y += 18;

    const employeeCardTop = y;

    doc.roundedRect(pageLeft, employeeCardTop, pageWidth, 78, 4).fill('#f9fafb');

    /*
     * Row 1
     */

    drawLabelValue('Employee Code', employee.employeeCode, 65, y + 15, 155);

    drawLabelValue(
      'Employee Name',
      `${employee.firstName} ${employee.lastName}`.trim(),
      310,
      y + 15,
      405,
    );

    /*
     * Row 2
     */

    drawLabelValue('Department', employee.department?.name ?? 'N/A', 65, y + 43, 155);

    drawLabelValue('Employment Type', employee.employmentType, 310, y + 43, 405);

    y += 105;

    /*
     * =========================================================
     * SALARY DETAILS
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text('SALARY DETAILS', pageLeft, y);

    y += 18;

    const tableTop = y;

    /*
     * Main table container
     */

    const headerHeight = 28;
    const subHeaderHeight = 23;
    const rowHeight = 25;

    const maxRows = Math.max(earnings.length, deductions.length, 1);

    const tableHeight = headerHeight + subHeaderHeight + maxRows * rowHeight + 32;

    /*
     * Outer border
     */

    doc
      .roundedRect(pageLeft, tableTop, pageWidth, tableHeight, 4)
      .strokeColor('#d1d5db')
      .lineWidth(0.8)
      .stroke();

    /*
     * Section headers
     */

    doc.rect(pageLeft, tableTop, pageWidth, headerHeight).fill('#f3f4f6');

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text('EARNINGS', leftColumn + 10, tableTop + 9);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text('DEDUCTIONS', rightColumn + 10, tableTop + 9);

    /*
     * Column divider
     */

    doc
      .strokeColor('#d1d5db')
      .lineWidth(0.7)
      .moveTo(297.5, tableTop)
      .lineTo(297.5, tableTop + tableHeight)
      .stroke();

    /*
     * Sub headers
     */

    const subHeaderY = tableTop + headerHeight;

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#6b7280')
      .text('COMPONENT', leftColumn + 10, subHeaderY + 8);

    doc.text('AMOUNT', leftColumn + 120, subHeaderY + 8, {
      width: 105,
      align: 'right',
    });

    doc.text('COMPONENT', rightColumn + 10, subHeaderY + 8);

    doc.text('AMOUNT', rightColumn + 120, subHeaderY + 8, {
      width: 105,
      align: 'right',
    });

    /*
     * Sub-header line
     */

    drawHorizontalLine(subHeaderY + subHeaderHeight);

    /*
     * Component rows
     */

    let rowY = subHeaderY + subHeaderHeight;

    for (let i = 0; i < maxRows; i++) {
      const earning = earnings[i];
      const deduction = deductions[i];

      /*
       * Row separator
       */

      if (i > 0) {
        doc
          .strokeColor('#f0f0f0')
          .lineWidth(0.5)
          .moveTo(pageLeft, rowY)
          .lineTo(pageRight, rowY)
          .stroke();
      }

      /*
       * Earnings
       */

      if (earning) {
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#111827')
          .text(earning.name, leftColumn + 10, rowY + 8, {
            width: 105,
            ellipsis: true,
          });

        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#111827')
          .text(formatAmount(earning.amount), leftColumn + 120, rowY + 8, {
            width: 105,
            align: 'right',
          });
      }

      /*
       * Deductions
       */

      if (deduction) {
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#111827')
          .text(deduction.name, rightColumn + 10, rowY + 8, {
            width: 105,
            ellipsis: true,
          });

        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#111827')
          .text(formatAmount(deduction.amount), rightColumn + 120, rowY + 8, {
            width: 105,
            align: 'right',
          });
      }

      rowY += rowHeight;
    }

    /*
     * Totals
     */

    const totalsY = rowY;

    doc.rect(pageLeft, totalsY, 247.5, 32).fill('#f9fafb');

    doc.rect(297.5, totalsY, 247.5, 32).fill('#f9fafb');

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor('#111827')
      .text('TOTAL EARNINGS', leftColumn + 10, totalsY + 11);

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(formatAmount(payrollItem.totalEarnings), leftColumn + 120, totalsY + 11, {
        width: 105,
        align: 'right',
      });

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text('TOTAL DEDUCTIONS', rightColumn + 10, totalsY + 11);

    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(formatAmount(payrollItem.totalDeductions), rightColumn + 120, totalsY + 11, {
        width: 105,
        align: 'right',
      });

    y = tableTop + tableHeight + 28;

    /*
     * =========================================================
     * SALARY SUMMARY
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text('SALARY SUMMARY', pageLeft, y);

    y += 18;

    /*
     * Gross Salary
     */

    doc.roundedRect(pageLeft, y, pageWidth, 35, 4).fill('#f9fafb');

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#374151')
      .text('Gross Salary', 65, y + 12);

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#111827')
      .text(formatAmount(payrollItem.grossSalary), 390, y + 11, {
        width: 130,
        align: 'right',
      });

    y += 45;

    /*
     * Total Deductions
     */

    doc.roundedRect(pageLeft, y, pageWidth, 35, 4).fill('#f9fafb');

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#374151')
      .text('Total Deductions', 65, y + 12);

    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#111827')
      .text(formatAmount(payrollItem.totalDeductions), 390, y + 11, {
        width: 130,
        align: 'right',
      });

    y += 50;

    /*
     * =========================================================
     * NET SALARY
     * =========================================================
     */

    doc.roundedRect(pageLeft, y, pageWidth, 72, 6).fill('#ecfdf5');

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#166534')
      .text('NET SALARY', 70, y + 18);

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#15803d')
      .text('Amount payable to employee', 70, y + 38);

    doc
      .font('Helvetica-Bold')
      .fontSize(19)
      .fillColor('#15803d')
      .text(formatAmount(payrollItem.netSalary), 320, y + 20, {
        width: 205,
        align: 'right',
      });

    y += 102;

    /*
     * =========================================================
     * PAYMENT INFORMATION
     * =========================================================
     */

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text('PAYMENT INFORMATION', pageLeft, y);

    y += 18;

    const paymentBoxTop = y;

    doc.roundedRect(pageLeft, paymentBoxTop, pageWidth, 75, 4).fill('#f9fafb');

    /*
     * Status
     */

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text('Status', 65, y + 15);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text(payrollRun.status, 155, y + 15);

    /*
     * Paid Date
     */

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6b7280')
      .text('Paid Date', 310, y + 15);

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text(formatDate(payrollRun.paidAt), 400, y + 15);

    /*
     * Payment Reference
     */

    if (payrollRun.paymentReference) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#6b7280')
        .text('Payment Reference', 65, y + 43);

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#111827')
        .text(payrollRun.paymentReference, 155, y + 43);
    }

    y += 105;

    /*
     * =========================================================
     * FOOTER
     * =========================================================
     */

    drawHorizontalLine(748, '#d1d5db');

    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#9ca3af')
      .text('This is a system-generated payslip and does not require a signature.', pageLeft, 758, {
        width: pageWidth,
        align: 'center',
      });

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#9ca3af')
      .text(`Generated on ${new Date().toLocaleString('en-IN')}`, pageLeft, 772, {
        width: pageWidth,
        align: 'center',
      });

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
}
