import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./.tmp-refutar/head",
  dialect: "mysql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
