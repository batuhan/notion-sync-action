import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

class AssetManager {
  constructor(baseDir, assetsDirName) {
    this.baseDir = baseDir;
    this.assetsDirName = assetsDirName || "notion-assets";
    this.assetsDir = path.join(this.baseDir, this.assetsDirName);
    this.cache = new Map();
    this.downloadedCount = 0;
  }

  async ensureDir() {
    await fs.mkdir(this.assetsDir, { recursive: true });
  }

  async resolveImageUrl(url) {
    if (!url) {
      return null;
    }

    if (this.cache.has(url)) {
      return this.cache.get(url);
    }

    await this.ensureDir();
    const safe = this.sanitizeAssetName(url);
    const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 8);
    const filename = `${safe.baseWithoutExt}-${hash}${safe.ext}`;
    const filePath = path.join(this.assetsDir, filename);
    const relativePath = `${this.assetsDirName}/${filename}`;

    try {
      await fs.access(filePath);
      this.cache.set(url, relativePath);
      return relativePath;
    } catch {
      // File does not exist yet. Continue with download.
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Asset request failed: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, buffer);
      this.downloadedCount += 1;
    } catch (error) {
      throw new Error(`Unable to download asset ${url}: ${error.message}`);
    }

    this.cache.set(url, relativePath);
    return relativePath;
  }

  sanitizeAssetName(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const base = path.basename(parsed.pathname) || "asset";
      const cleanBase = base
        .replace(/\?.*$/, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 80);

      const ext = path.extname(cleanBase);
      const stem = ext ? cleanBase.slice(0, -ext.length) || "asset" : cleanBase || "asset";
      const finalExt = ext || ".bin";
      return { baseWithoutExt: stem, ext: finalExt };
    } catch {
      return { baseWithoutExt: "asset", ext: ".bin" };
    }
  }
}

export { AssetManager };
