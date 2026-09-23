import {PrismaClient} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // 1. Create/Ensure all Roles exist
  const roleNames = ['SUPER_ADMIN', 'ORGANIZATION_ADMIN', 'HR_ADMIN', 'EMPLOYEE'];
  const roles: Record<string, any> = {};

  for (const name of roleNames) {
    roles[name] = await prisma.role.upsert({
      where: {name},
      update: {},
      create: {name},
    });
  }

  // 2. Create Super Admin User
  const defaultPassword = await bcrypt.hash('Admin@123', 10);
  const employeePassword = await bcrypt.hash('Employee@123', 10);

  const superAdmin = await prisma.user.upsert({
    where: {email: 'superadmin@system.com'},
    update: {},
    create: {
      email: 'superadmin@system.com',
      password: defaultPassword,
      firstName: 'Super',
      lastName: 'Admin',
      organizationId: null,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: superAdmin.id,
        roleId: roles['SUPER_ADMIN'].id,
      },
    },
    update: {},
    create: {
      userId: superAdmin.id,
      roleId: roles['SUPER_ADMIN'].id,
    },
  });

  // 3. Create Sample Organization
  const org = await prisma.organization.upsert({
    where: {code: 'ACME'},
    update: {},
    create: {
      name: 'Acme Corporation',
      code: 'ACME',
    },
  });

  // 4. Create Organization Admin User
  const orgAdmin = await prisma.user.upsert({
    where: {email: 'admin@acme.com'},
    update: {},
    create: {
      email: 'admin@acme.com',
      password: defaultPassword,
      firstName: 'Acme',
      lastName: 'Admin',
      organizationId: org.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: orgAdmin.id,
        roleId: roles['ORGANIZATION_ADMIN'].id,
      },
    },
    update: {},
    create: {
      userId: orgAdmin.id,
      roleId: roles['ORGANIZATION_ADMIN'].id,
    },
  });

  // 5. Create Sample Department
  const department = await prisma.department.upsert({
    where: {
      organizationId_code: {
        organizationId: org.id,
        code: 'ENG',
      },
    },
    update: {},
    create: {
      name: 'Engineering',
      code: 'ENG',
      organizationId: org.id,
    },
  });

  // 6. Create Sample Employee Profile
  const employee = await prisma.employee.upsert({
    where: {
      organizationId_employeeCode: {
        organizationId: org.id,
        employeeCode: 'EMP001',
      },
    },
    update: {
      email: 'employee@acme.com',
    },
    create: {
      employeeCode: 'EMP001',
      firstName: 'John',
      lastName: 'Doe',
      email: 'employee@acme.com',
      phone: '+1234567890',
      dateOfJoining: new Date('2026-01-01'),
      organizationId: org.id,
      departmentId: department.id,
    },
  });

  // 7. Create Salary Structure for Employee
  let salaryStructure = await prisma.salaryStructure.findFirst({
    where: {
      employeeId: employee.id,
      organizationId: org.id,
    },
  });

  if (!salaryStructure) {
    salaryStructure = await prisma.salaryStructure.create({
      data: {
        employeeId: employee.id,
        organizationId: org.id,
        effectiveFrom: new Date('2026-01-01'),
        components: {
          create: [
            {
              name: 'Basic',
              type: 'EARNING',
              calculationType: 'FIXED',
              amount: 50000,
            },
            {
              name: 'HRA',
              type: 'EARNING',
              calculationType: 'FIXED',
              amount: 20000,
            },
          ],
        },
      },
    });
  }

  // 8. Create September Payroll Period
  const payrollPeriod = await prisma.payrollPeriod.upsert({
    where: {
      organizationId_startDate_endDate: {
        organizationId: org.id,
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-30'),
      },
    },
    update: {},
    create: {
      name: 'September 2026',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-30'),
      organizationId: org.id,
    },
  });

  // 9. Create Employee User Login
  const employeeUser = await prisma.user.upsert({
    where: {email: 'employee@acme.com'},
    update: {},
    create: {
      email: 'employee@acme.com',
      password: employeePassword,
      firstName: 'John',
      lastName: 'Doe',
      organizationId: org.id,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: employeeUser.id,
        roleId: roles['EMPLOYEE'].id,
      },
    },
    update: {},
    create: {
      userId: employeeUser.id,
      roleId: roles['EMPLOYEE'].id,
    },
  });

  console.log('Seed completed successfully! Ready for Postman testing:');
  console.log('-------------------------------------------------------');
  console.log('Organization:     Acme Corporation (ID:', org.id, ')');
  console.log('Admin Login:      admin@acme.com    / Admin@123');
  console.log('Employee Login:   employee@acme.com / Employee@123');
  console.log('Employee Code:    EMP001 (Salary: ₹50,000 Basic + ₹20,000 HRA)');
  console.log('Payroll Period:   September 2026 (ID:', payrollPeriod.id, ')');
  console.log('-------------------------------------------------------');
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
