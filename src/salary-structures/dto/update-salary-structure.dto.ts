import {IsArray, IsDateString, IsOptional, ValidateNested} from 'class-validator';

import {Type} from 'class-transformer';

import {CreateSalaryComponentDto} from './create-salary-component.dto';

export class UpdateSalaryStructureDto {
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({each: true})
  @Type(() => CreateSalaryComponentDto)
  components?: CreateSalaryComponentDto[];
}
