import { openDB } from "idb";

const DB_NAME = "brev-db";
const DB_VERSION = 1;

export async function getDatabase() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade() {
      // Stores will be added in later chunks.
    }
  });
}
