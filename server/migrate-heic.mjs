// One-off migration: convert existing HEIC/HEIF uploads (member avatars and
// tournament photos) to JPEG so they display on desktop browsers.
//
// Usage (from the server folder, with SQL_CONNECTION_STRING set, e.g. in .env):
//   node migrate-heic.mjs
//
// Safe to re-run: already-converted (.jpg) rows are skipped. Files that no
// longer exist on disk are reported and left for manual cleanup.

import "dotenv/config";
import path from "path";
import fs from "fs";
import sql from "mssql";
import heicConvert from "heic-convert";

const connectionString = process.env.SQL_CONNECTION_STRING;
if (!connectionString) {
  console.error("SQL_CONNECTION_STRING is not set. Aborting.");
  process.exit(1);
}

const uploadDir =
  process.env.UPLOAD_DIR ||
  (process.env.HOME
    ? path.join(process.env.HOME, "data", "uploads")
    : path.join(process.cwd(), "uploads"));

const isHeic = (filename) => /\.(heic|heif)$/i.test(filename || "");

// Convert a single file on disk to JPEG. Returns the new filename, or null if
// the source is missing / conversion fails.
async function convertFile(filename) {
  const sourcePath = path.join(uploadDir, filename);
  if (!fs.existsSync(sourcePath)) {
    console.warn(`  ! source missing on disk: ${filename}`);
    return null;
  }
  try {
    const input = await fs.promises.readFile(sourcePath);
    const output = await heicConvert({ buffer: input, format: "JPEG", quality: 0.9 });
    const newFilename = filename.replace(/\.[^.]*$/, "") + ".jpg";
    await fs.promises.writeFile(path.join(uploadDir, newFilename), Buffer.from(output));
    await fs.promises.unlink(sourcePath).catch(() => {});
    return newFilename;
  } catch (err) {
    console.error(`  ! conversion failed for ${filename}:`, err.message);
    return null;
  }
}

async function main() {
  console.log("Connecting to SQL...");
  const pool = await new sql.ConnectionPool(connectionString).connect();
  console.log(`Upload directory: ${uploadDir}\n`);

  let converted = 0;
  let skipped = 0;

  // ----- member avatars -----
  console.log("Scanning member avatars...");
  const users = await pool.request().query(`
    SELECT id, avatar FROM dbo.users
    WHERE avatar IS NOT NULL AND (avatar LIKE '%.heic' OR avatar LIKE '%.heif')
  `);
  for (const row of users.recordset) {
    if (!isHeic(row.avatar)) continue;
    console.log(`  user #${row.id}: ${row.avatar}`);
    const newFilename = await convertFile(row.avatar);
    if (!newFilename) {
      skipped++;
      continue;
    }
    await pool
      .request()
      .input("Id", sql.Int, row.id)
      .input("Avatar", sql.NVarChar(260), newFilename)
      .input("AvatarType", sql.NVarChar(100), "image/jpeg")
      .query(`UPDATE dbo.users SET avatar = @Avatar, avatar_type = @AvatarType WHERE id = @Id`);
    console.log(`    -> ${newFilename}`);
    converted++;
  }

  // ----- tournament photos -----
  console.log("\nScanning tournament photos...");
  const photos = await pool.request().query(`
    SELECT id, filename FROM dbo.tournament_photos
    WHERE filename IS NOT NULL AND (filename LIKE '%.heic' OR filename LIKE '%.heif')
  `);
  for (const row of photos.recordset) {
    if (!isHeic(row.filename)) continue;
    console.log(`  photo #${row.id}: ${row.filename}`);
    const newFilename = await convertFile(row.filename);
    if (!newFilename) {
      skipped++;
      continue;
    }
    await pool
      .request()
      .input("Id", sql.Int, row.id)
      .input("Filename", sql.NVarChar(260), newFilename)
      .input("ContentType", sql.NVarChar(100), "image/jpeg")
      .query(`UPDATE dbo.tournament_photos SET filename = @Filename, content_type = @ContentType WHERE id = @Id`);
    console.log(`    -> ${newFilename}`);
    converted++;
  }

  console.log(`\nDone. Converted ${converted}, skipped ${skipped}.`);
  await pool.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
