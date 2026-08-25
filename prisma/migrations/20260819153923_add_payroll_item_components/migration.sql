/*
  Warnings:

  - Added the required column `calculationType` to the `PayrollItemComponent` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `PayrollItemComponent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PayrollItemComponent" ADD COLUMN     "calculationType" "SalaryCalculationType" NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
