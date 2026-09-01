-- AlterTable
ALTER TABLE "convites_organizacao" ALTER COLUMN "criadoPorId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "convites_organizacao" ADD CONSTRAINT "convites_organizacao_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
