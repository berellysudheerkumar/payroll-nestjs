import {Test, TestingModule} from '@nestjs/testing';
import {SalaryStructuresController} from './salary-structures.controller';

describe('SalaryStructuresController', () => {
  let controller: SalaryStructuresController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalaryStructuresController],
    }).compile();

    controller = module.get<SalaryStructuresController>(SalaryStructuresController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
