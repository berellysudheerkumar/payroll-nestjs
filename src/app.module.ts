import {Module} from '@nestjs/common';
import {ConfigModule} from '@nestjs/config';
import {PrismaModule} from './prisma/prisma.module';
import {AuthModule} from './auth/auth.module';
import {OrganizationsModule} from './organizations/organizations.module';
import {EmployeesModule} from './employees/employees.module';
import {DepartmentsModule} from './departments/departments.module';
import {SalaryStructuresModule} from './salary-structures/salary-structures.module';
import {PayrollModule} from './payroll/payroll.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    EmployeesModule,
    DepartmentsModule,
    SalaryStructuresModule,
    PayrollModule,
  ],
})
export class AppModule {}
