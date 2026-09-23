import {ApiPropertyOptional} from '@nestjs/swagger';
import {AttendanceStatus} from '@prisma/client';
import {IsDateString, IsEnum, IsInt, IsOptional, IsString, Min} from 'class-validator';

export class UpdateAttendanceDto {
  @ApiPropertyOptional({
    description: 'Updated attendance status',
    enum: AttendanceStatus,
  })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional({
    description: 'Adjusted check-in timestamp',
    example: '2026-09-24T09:15:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({
    description: 'Adjusted check-out timestamp',
    example: '2026-09-24T18:15:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({
    description: 'Manual override of working minutes',
    example: 540,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  workingMinutes?: number;

  @ApiPropertyOptional({
    description: 'Reason for regularization or modification',
    example: 'Biometric device offline, regularization approved',
  })
  @IsOptional()
  @IsString()
  remarks?: string;
}
