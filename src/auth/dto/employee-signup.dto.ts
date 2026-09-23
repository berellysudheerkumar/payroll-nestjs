import {ApiProperty, ApiPropertyOptional} from '@nestjs/swagger';
import {IsEmail, IsNotEmpty, IsOptional, IsString, MinLength} from 'class-validator';

export class EmployeeSignUpDto {
  @ApiProperty({
    description: 'Company organization code provided by your administrator (e.g. ACME)',
    example: 'ACME',
  })
  @IsNotEmpty({message: 'Organization code is required'})
  @IsString()
  organizationCode: string;

  @ApiProperty({example: 'John'})
  @IsNotEmpty({message: 'First name is required'})
  @IsString()
  firstName: string;

  @ApiProperty({example: 'Doe'})
  @IsNotEmpty({message: 'Last name is required'})
  @IsString()
  lastName: string;

  @ApiProperty({example: 'john.doe@company.com'})
  @IsNotEmpty({message: 'Work email is required'})
  @IsEmail({}, {message: 'Please provide a valid work email'})
  email: string;

  @ApiProperty({example: 'Password@123', minLength: 6})
  @IsNotEmpty({message: 'Password is required'})
  @IsString()
  @MinLength(6, {message: 'Password must be at least 6 characters'})
  password: string;

  @ApiPropertyOptional({example: 'EMP001', description: 'Employee badge/code if assigned'})
  @IsOptional()
  @IsString()
  employeeCode?: string;
}
