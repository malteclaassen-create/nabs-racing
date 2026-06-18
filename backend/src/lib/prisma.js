import { PrismaClient } from "@prisma/client";

// Single shared Prisma client instance.
const prisma = new PrismaClient();

export default prisma;
