import {IsArray, IsDateString, IsUUID, ValidateNested} from 'class-validator';

import {Type} from 'class-transformer';

import {CreateSalaryComponentDto} from './create-salary-component.dto';

export class CreateSalaryStructureDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  effectiveFrom: string;

  @IsArray()
  @ValidateNested({each: true})
  @Type(() => CreateSalaryComponentDto)
  components: CreateSalaryComponentDto[];
}
