-- CreateEnum
CREATE TYPE "PayrollAuditAction" AS ENUM ('CREATED', 'PROCESSED', 'APPROVED', 'CANCELLED', 'PAID');

-- CreateTable
CREATE TABLE "PayrollRunAudit" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "PayrollAuditAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRunAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollRunAudit_payrollRunId_idx" ON "PayrollRunAudit"("payrollRunId");

-- CreateIndex
CREATE INDEX "PayrollRunAudit_userId_idx" ON "PayrollRunAudit"("userId");

-- AddForeignKey
ALTER TABLE "PayrollRunAudit" ADD CONSTRAINT "PayrollRunAudit_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunAudit" ADD CONSTRAINT "PayrollRunAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
