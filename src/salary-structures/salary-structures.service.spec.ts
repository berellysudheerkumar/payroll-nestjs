import {Test, TestingModule} from '@nestjs/testing';
import {SalaryStructuresService} from './salary-structures.service';

describe('SalaryStructuresService', () => {
  let service: SalaryStructuresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalaryStructuresService],
    }).compile();

    service = module.get<SalaryStructuresService>(SalaryStructuresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
