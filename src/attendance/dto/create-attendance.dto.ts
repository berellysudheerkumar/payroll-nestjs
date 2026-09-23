import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {AttendanceStatus} from '@prisma/client';
import {IsDateString, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min} from 'class-validator';

export class CreateAttendanceDto {
  @ApiProperty({
    description: 'Target Employee ID',
    example: 'clx... or uuid',
  })
  @IsNotEmpty()
  @IsString()
  employeeId: string;

  @ApiProperty({
    description: 'Attendance date (YYYY-MM-DD or ISO string)',
    example: '2026-09-24',
  })
  @IsNotEmpty()
  @IsDateString()
  date: string;

  @ApiPropertyOptional({
    description: 'Attendance status',
    enum: AttendanceStatus,
    default: AttendanceStatus.PRESENT,
  })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional({
    description: 'Check-in timestamp',
    example: '2026-09-24T09:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @ApiPropertyOptional({
    description: 'Check-out timestamp',
    example: '2026-09-24T18:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @ApiPropertyOptional({
    description: 'Total working minutes (auto-calculated from checkIn/checkOut if omitted)',
    example: 540,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  workingMinutes?: number;

  @ApiPropertyOptional({
    description: 'Remarks or notes',
    example: 'Manual entry by HR',
  })
  @IsOptional()
  @IsString()
  remarks?: string;
}
