import {ApiPropertyOptional} from '@nestjs/swagger';
import {IsDateString, IsOptional, IsString} from 'class-validator';

export class CheckInDto {
  @ApiPropertyOptional({
    description: 'Employee ID (optional if logged in as the employee)',
    example: 'clx... or uuid',
  })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({
    description: 'Check-in timestamp in ISO string (defaults to now if omitted)',
    example: '2026-09-24T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({
    description: 'Optional remarks or location note for check-in',
    example: 'Checked in from Bangalore office',
  })
  @IsOptional()
  @IsString()
  remarks?: string;
}
