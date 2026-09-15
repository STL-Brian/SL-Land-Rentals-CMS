import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";
const here=dirname(fileURLToPath(import.meta.url));const dir=join(here,"../migrations");const files=(await readdir(dir)).filter(f=>/^\d+.*\.sql$/.test(f)).sort();
for(const file of files)await pool().query(await readFile(join(dir,file),"utf8"));
await pool().end();console.log(`database migrations complete (${files.length})`);
