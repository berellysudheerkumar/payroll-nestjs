import {IsNotEmpty, IsOptional, IsString} from 'class-validator';

export class CreatePayrollRunDto {
  @IsString()
  @IsNotEmpty()
  payrollPeriodId: string;
}

export class MarkPayrollPaidDto {
  @IsOptional()
  @IsString()
  paymentReference?: string;
}
