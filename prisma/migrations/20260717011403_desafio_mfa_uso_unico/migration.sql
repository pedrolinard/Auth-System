-- CreateTable
CREATE TABLE "desafios_mfa_consumidos" (
    "jti" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "desafios_mfa_consumidos_pkey" PRIMARY KEY ("jti")
);
