import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();


async function main() {

  console.log('Starting database seed...');


  // Create roles

  const superAdminRole =
    await prisma.role.upsert({
      where: {
        name: 'SUPER_ADMIN',
      },
      update: {},
      create: {
        name: 'SUPER_ADMIN',
      },
    });


  const organizationAdminRole =
    await prisma.role.upsert({
      where: {
        name: 'ORGANIZATION_ADMIN',
      },
      update: {},
      create: {
        name: 'ORGANIZATION_ADMIN',
      },
    });



  // Create Super Admin user

  const hashedPassword =
    await bcrypt.hash(
      'Admin@123',
      10,
    );


  const superAdmin =
    await prisma.user.upsert({

      where: {
        email: 'superadmin@system.com',
      },

      update: {},

      create: {

        email: 'superadmin@system.com',

        password: hashedPassword,

        firstName: 'Super',

        lastName: 'Admin',

        // No organization
        organizationId: null,

      },

    });



  // Assign SUPER_ADMIN role

  await prisma.userRole.upsert({

    where: {
      userId_roleId: {
        userId: superAdmin.id,
        roleId: superAdminRole.id,
      },
    },

    update: {},

    create: {

      userId: superAdmin.id,

      roleId: superAdminRole.id,

    },

  });



  console.log('Seed completed successfully');

  console.log({
    superAdmin: superAdmin.email,
    rolesCreated: [
      superAdminRole.name,
      organizationAdminRole.name,
    ],
  });

}



main()
  .catch((error) => {

    console.error(error);

    process.exit(1);

  })
  .finally(async () => {

    await prisma.$disconnect();

  });