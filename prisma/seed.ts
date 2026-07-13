import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();


async function main() {

  const superAdminRole =
    await prisma.role.upsert({
      where:{
        name:'SUPER_ADMIN'
      },
      update:{},
      create:{
        name:'SUPER_ADMIN'
      }
    });


  const orgAdminRole =
    await prisma.role.upsert({
      where:{
        name:'ORGANIZATION_ADMIN'
      },
      update:{},
      create:{
        name:'ORGANIZATION_ADMIN'
      }
    });


  const password =
    await bcrypt.hash(
      'Admin@123',
      10
    );


  const superAdmin =
    await prisma.user.upsert({
      where:{
        email:'superadmin@system.com'
      },
      update:{},
      create:{
        email:'superadmin@system.com',
        password,

        firstName:'Super',
        lastName:'Admin'
      }
    });


  await prisma.userRole.create({
    data:{
      userId:superAdmin.id,
      roleId:superAdminRole.id
    }
  });


  console.log(
    'SuperAdmin created'
  );
}


main()
.catch(console.error)
.finally(()=>{
  prisma.$disconnect();
});