-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_usuarios" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "mfaAtivado" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);
INSERT INTO "new_usuarios" ("atualizadoEm", "criadoEm", "email", "id", "nome", "senhaHash") SELECT "atualizadoEm", "criadoEm", "email", "id", "nome", "senhaHash" FROM "usuarios";
DROP TABLE "usuarios";
ALTER TABLE "new_usuarios" RENAME TO "usuarios";
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
