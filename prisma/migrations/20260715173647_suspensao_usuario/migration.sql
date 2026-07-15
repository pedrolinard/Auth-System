-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "suspenso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suspensoAte" TIMESTAMP(3),
ADD COLUMN     "suspensoMotivo" TEXT;
