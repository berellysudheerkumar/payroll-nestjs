import {IsEnum, IsNumber, IsOptional, IsString, Min} from 'class-validator';

import {SalaryCalculationBasis, SalaryCalculationType, SalaryComponentType} from '@prisma/client';

export class CreateSalaryComponentDto {
  @IsString()
  name: string;

  @IsEnum(SalaryComponentType)
  type: SalaryComponentType;

  @IsEnum(SalaryCalculationType)
  calculationType: SalaryCalculationType;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsEnum(SalaryCalculationBasis)
  calculationBasis?: SalaryCalculationBasis;
}
