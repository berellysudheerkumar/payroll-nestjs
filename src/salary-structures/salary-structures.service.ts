import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';

import {PrismaService} from '../prisma/prisma.service';

import {SalaryCalculationType} from '@prisma/client';

import {CreateSalaryStructureDto} from './dto/create-salary-structure.dto';
import {UpdateSalaryStructureDto} from './dto/update-salary-structure.dto';

@Injectable()
export class SalaryStructuresService {
  constructor(private readonly prisma: PrismaService) {}

  private validateComponents(components: CreateSalaryStructureDto['components']) {
    for (const component of components) {
      if (
        component.calculationType === SalaryCalculationType.PERCENTAGE &&
        !component.calculationBasis
      ) {
        throw new BadRequestException(
          `Calculation basis is required for percentage component "${component.name}"`,
        );
      }

      if (component.calculationType === SalaryCalculationType.FIXED && component.calculationBasis) {
        throw new BadRequestException(
          `Calculation basis should not be provided for fixed component "${component.name}"`,
        );
      }
    }
  }

  async create(organizationId: string, dto: CreateSalaryStructureDto) {
    this.validateComponents(dto.components);

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: dto.employeeId,
        organizationId,
      },
    });

    if (!employee) {
      throw new BadRequestException('Employee does not belong to this organization');
    }

    return this.prisma.$transaction(async tx => {
      const structure = await tx.salaryStructure.create({
        data: {
          employeeId: dto.employeeId,
          organizationId,
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      });

      if (dto.components.length > 0) {
        await tx.salaryComponent.createMany({
          data: dto.components.map(component => ({
            salaryStructureId: structure.id,
            name: component.name,
            type: component.type,
            calculationType: component.calculationType,
            calculationBasis: component.calculationBasis ?? null,
            amount: component.amount,
          })),
        });
      }

      return tx.salaryStructure.findUnique({
        where: {
          id: structure.id,
        },
        include: {
          components: true,
          employee: true,
        },
      });
    });
  }

  async findAll(organizationId: string) {
    return this.prisma.salaryStructure.findMany({
      where: {
        organizationId,
      },
      include: {
        components: true,
        employee: true,
      },
      orderBy: {
        effectiveFrom: 'desc',
      },
    });
  }

  async findOne(organizationId: string, id: string) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        components: true,
        employee: true,
      },
    });

    if (!structure) {
      throw new NotFoundException('Salary structure not found');
    }

    return structure;
  }

  async update(organizationId: string, id: string, dto: UpdateSalaryStructureDto) {
    const existing = await this.prisma.salaryStructure.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary structure not found');
    }

    return this.prisma.$transaction(async tx => {
      await tx.salaryStructure.update({
        where: {
          id,
        },
        data: {
          effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,

          effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        },
      });

      if (dto.components) {
        await tx.salaryComponent.deleteMany({
          where: {
            salaryStructureId: id,
          },
        });

        if (dto.components.length > 0) {
          await tx.salaryComponent.createMany({
            data: dto.components.map(component => ({
              salaryStructureId: id,
              name: component.name,
              type: component.type,
              calculationType: component.calculationType,
              calculationBasis: component.calculationBasis ?? null,
              amount: component.amount,
            })),
          });
        }
      }

      return tx.salaryStructure.findUnique({
        where: {
          id,
        },
        include: {
          components: true,
          employee: true,
        },
      });
    });
  }

  async remove(organizationId: string, id: string) {
    const existing = await this.prisma.salaryStructure.findFirst({
      where: {
        id,
        organizationId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Salary structure not found');
    }

    await this.prisma.salaryStructure.delete({
      where: {
        id,
      },
    });

    return {
      message: 'Salary structure deleted successfully',
    };
  }
}
