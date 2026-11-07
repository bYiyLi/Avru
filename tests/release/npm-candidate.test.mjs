import assert from "node:assert/strict";
import { mkdtemp, cp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyPackage } from "../../scripts/release/verify.mjs";

test("npm channel requires explicit opt-in and exact dev metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "avru-npm-test-"));
  try {
    await cp("artifacts/avru", dir, { recursive: true });
    await assert.rejects(verifyPackage(dir, "npm-dev"));
    const path = join(dir, "package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.private = false;
    manifest.repository = { url: "git+https://github.com/bYiyLi/Avru.git" };
    manifest.publishConfig = {
      tag: "dev",
      access: "public",
      registry: "https://registry.npmjs.org/",
    };
    await writeFile(path, JSON.stringify(manifest));
    await verifyPackage(dir, "npm-dev");
    await assert.rejects(verifyPackage(dir, "npm-scoped-dev"));
    manifest.name = "@avru/setup";
    await writeFile(path, JSON.stringify(manifest));
    await verifyPackage(dir, "npm-scoped-dev");
    await assert.rejects(verifyPackage(dir, "npm-dev"));
    await assert.rejects(verifyPackage(dir));
    await assert.rejects(verifyPackage(dir, "unknown"));
    manifest.publishConfig.tag = "latest";
    await writeFile(path, JSON.stringify(manifest));
    await assert.rejects(verifyPackage(dir, "npm-dev"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
