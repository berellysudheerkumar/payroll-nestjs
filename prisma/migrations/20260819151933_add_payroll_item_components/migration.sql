-- CreateTable
CREATE TABLE "PayrollItemComponent" (
    "id" TEXT NOT NULL,
    "payrollItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SalaryComponentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollItemComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollItemComponent_payrollItemId_idx" ON "PayrollItemComponent"("payrollItemId");

-- AddForeignKey
ALTER TABLE "PayrollItemComponent" ADD CONSTRAINT "PayrollItemComponent_payrollItemId_fkey" FOREIGN KEY ("payrollItemId") REFERENCES "PayrollItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
