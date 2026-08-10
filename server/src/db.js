// Client Prisma partagé par toutes les routes.
import "./env.js";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
