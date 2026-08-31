import {IsEmail, IsOptional, IsString, IsUUID} from 'class-validator';

export class UpdateOrganizationAdministratorDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
