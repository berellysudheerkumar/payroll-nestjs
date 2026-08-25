-- CreateEnum
CREATE TYPE "SalaryCalculationBasis" AS ENUM ('BASIC', 'GROSS', 'FIXED_EARNINGS', 'TOTAL_EARNINGS');

-- AlterTable
ALTER TABLE "SalaryComponent" ADD COLUMN     "calculationBasis" "SalaryCalculationBasis";
