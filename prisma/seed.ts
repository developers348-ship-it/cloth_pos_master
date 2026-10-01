import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Organization
  const org = await prisma.organization.upsert({
    where: { id: "org_sidhey_sheikh_cloth" },
    update: {},
    create: {
      id: "org_sidhey_sheikh_cloth",
      name: "Sidhey Sheikh Cloth Center",
    },
  });
  console.log("✅ Organization:", org.name);

  // 2. Main Branch
  const branch = await prisma.branch.upsert({
    where: { id: "branch_warburton" },
    update: {},
    create: {
      id: "branch_warburton",
      name: "Sidhey Sheikh Cloth Center - Warburton",
      address: "Bano Bazar, Warburton",
      city: "Warburton",
      phone: "0307-1483620",
      mobile: "0300-4346090",
      footerTerms:
        "* ALL PRICES ARE FIXED\n* NO CLAIM ON STICH SUIT\n* SUIT EXCHANGED WITHIN SAME BRANDS ONLY\n* BRING INVOICE FOR EXCHANGE/CLAIM/RETURN WITHIN 7 DAYS\n* NO EXCHANGE/CLAIM ON CUT PIECE AND PRODUCTS OF PREVIOUS SEASON OR SOLD ON SALES/DISCOUNTS OR READY TO WEAR ITEMS",
      orgId: org.id,
    },
  });
  console.log("✅ Branch:", branch.name);

  // 3. Super Admin user
  const adminPassword = await bcrypt.hash("admin123", 12);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@sidheysheikhcloth.com" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@sidheysheikhcloth.com",
      passwordHash: adminPassword,
      role: "SUPER_ADMIN",
    },
  });
  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: adminUser.id, branchId: branch.id } },
    update: {},
    create: { userId: adminUser.id, branchId: branch.id },
  });
  console.log("✅ Admin user: admin@sidheysheikhcloth.com / admin123");

  // 4. Manager user
  const managerPassword = await bcrypt.hash("manager123", 12);
  const managerUser = await prisma.user.upsert({
    where: { email: "manager@sidheysheikhcloth.com" },
    update: {},
    create: {
      name: "Mian Mazhar",
      email: "manager@sidheysheikhcloth.com",
      passwordHash: managerPassword,
      role: "MANAGER",
    },
  });
  await prisma.userBranch.upsert({
    where: {
      userId_branchId: { userId: managerUser.id, branchId: branch.id },
    },
    update: {},
    create: { userId: managerUser.id, branchId: branch.id },
  });
  console.log("✅ Manager user: manager@sidheysheikhcloth.com / manager123");

  // 5. Cashier user
  const cashierPassword = await bcrypt.hash("cashier123", 12);
  const cashierUser = await prisma.user.upsert({
    where: { email: "cashier@sidheysheikhcloth.com" },
    update: {},
    create: {
      name: "Cashier",
      email: "cashier@sidheysheikhcloth.com",
      passwordHash: cashierPassword,
      role: "CASHIER",
    },
  });
  await prisma.userBranch.upsert({
    where: {
      userId_branchId: { userId: cashierUser.id, branchId: branch.id },
    },
    update: {},
    create: { userId: cashierUser.id, branchId: branch.id },
  });
  console.log("✅ Cashier user: cashier@sidheysheikhcloth.com / cashier123");

  // 6. Walking Customer (default, ID 1001)
  const walkingCustomer = await prisma.party.upsert({
    where: { accountId: 1001 },
    update: {},
    create: {
      accountId: 1001,
      name: "Walking Customer",
      type: "CASH",
      isDefault: true,
      previousBalance: 0,
      creditLimit: 0,
    },
  });
  console.log("✅ Walking Customer (ID: 1001)");

  // 7. Sample items (fabric products)
  const sampleItems = [
    {
      name: "2460-BUTRFLY STYLE LAWN 3PC",
      category: "Lawn",
      brand: "Butterfly",
      unit: "PCS" as const,
      purchasePrice: 3500,
      salePrice: 4790,
      openingStock: 50,
      minLevel: 5,
    },
    {
      name: "PREMIUM LAWN FABRIC",
      category: "Lawn",
      brand: "Generic",
      unit: "MTR" as const,
      purchasePrice: 800,
      salePrice: 1200,
      openingStock: 100,
      minLevel: 10,
    },
    {
      name: "COTTON SUIT MATERIAL",
      category: "Cotton",
      brand: "Generic",
      unit: "GAZ" as const,
      purchasePrice: 500,
      salePrice: 750,
      openingStock: 200,
      minLevel: 20,
    },
  ];

  for (const itemData of sampleItems) {
    // Check if item already exists by name
    const existing = await prisma.item.findFirst({ where: { name: itemData.name } });
    const item = existing ?? await prisma.item.create({ data: itemData });
    // Create stock for branch
    await prisma.itemStock.upsert({
      where: { itemId_branchId: { itemId: item.id, branchId: branch.id } },
      update: {},
      create: {
        itemId: item.id,
        branchId: branch.id,
        qty: itemData.openingStock,
      },
    });
    console.log(`✅ Item: ${item.name}`);
  }

  console.log("\n🎉 Seeding complete!");
  console.log("─────────────────────────────────────────");
  console.log("Login credentials:");
  console.log("  Super Admin : admin@sidheysheikhcloth.com    / admin123");
  console.log("  Manager     : manager@sidheysheikhcloth.com  / manager123");
  console.log("  Cashier     : cashier@sidheysheikhcloth.com  / cashier123");
  console.log("─────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
