import {Module} from '@nestjs/common';
import {PayrollController} from './payroll.controller';
import {PayrollService} from './payroll.service';
import {OpenaiModule} from '../openai/openai.module';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService],
  imports: [OpenaiModule],
})
export class PayrollModule {}
