import {IsEmail, IsString} from 'class-validator';

export class CreateOrganizationAdminDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  adminPassword: string;

  @IsString()
  adminFirstName: string;

  @IsString()
  adminLastName: string;
}
