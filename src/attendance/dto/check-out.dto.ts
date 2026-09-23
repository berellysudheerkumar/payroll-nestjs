import {ApiPropertyOptional} from '@nestjs/swagger';
import {IsDateString, IsOptional, IsString} from 'class-validator';

export class CheckOutDto {
  @ApiPropertyOptional({
    description: 'Employee ID (optional if logged in as the employee)',
    example: 'clx... or uuid',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Check-out timestamp in ISO string (defaults to now if omitted)',
    example: '2026-09-24T18:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({
    description: 'Optional remarks for check-out',
    example: 'Completed full day shift',
  })
  @IsOptional()
  @IsString()
  remarks?: string;
}
