/**
 * Fail the build when a cross-page documentation link points at a heading that
 * does not exist.
 *
 * `mkdocs build --strict` does not cover this: a link to a missing page is a
 * warning, but a link to a **missing anchor on an existing page** is only
 * reported at `INFO` level, so `--strict` stays green while the link is dead.
 * This walks the built `site/` tree instead, resolving every `href` that carries
 * a fragment against the target page's real `id` attributes.
 *
 * Run it after `mkdocs build`; `npm run docs:check` chains both.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize } from "node:path";

/** Root of the built site, relative to the repository root. */
const SITE_DIR = "site";

/** Directories under the site root that hold assets, not pages. */
const SKIPPED_DIRS = new Set(["assets", "search", "stylesheets", "javascripts"]);

/**
 * Recursively collect every HTML page under a directory.
 *
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Paths of the HTML files found.
 */
function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (SKIPPED_DIRS.has(entry)) continue;
      found.push(...htmlFiles(path));
    } else if (entry.endsWith(".html")) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Resolve an `href` to the HTML file it addresses.
 *
 * @param {string} pageDir - Directory of the page holding the link.
 * @param {string} target - The `href` with its fragment already stripped.
 * @returns {string} Path of the file the link resolves to.
 */
function resolveTarget(pageDir, target) {
  const path = normalize(join(pageDir, target));
  try {
    return statSync(path).isDirectory() ? join(path, "index.html") : path;
  } catch {
    return path;
  }
}

/**
 * Check every cross-page fragment link in the built site.
 *
 * @returns {Array<{page: string, href: string, reason: string}>} The broken links.
 */
function brokenLinks() {
  const broken = [];
  const idsByFile = new Map();
  for (const page of htmlFiles(SITE_DIR)) {
    const html = readFileSync(page, "utf8");
    const pageDir = page.slice(0, page.lastIndexOf("/"));
    for (const [, href] of html.matchAll(/href="([^"]+#[^"]+)"/g)) {
      if (href.startsWith("http") || href.startsWith("#")) continue;
      const [target, fragment] = href.split("#");
      const file = resolveTarget(pageDir, target);
      if (!idsByFile.has(file)) {
        try {
          const targetHtml = readFileSync(file, "utf8");
          idsByFile.set(
            file,
            new Set([...targetHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1])),
          );
        } catch {
          idsByFile.set(file, null);
        }
      }
      const ids = idsByFile.get(file);
      if (ids === null) {
        broken.push({ page, href, reason: "target page does not exist" });
      } else if (!ids.has(decodeURIComponent(fragment))) {
        broken.push({ page, href, reason: "anchor does not exist on the target page" });
      }
    }
  }
  return broken;
}

const broken = brokenLinks();
if (broken.length > 0) {
  for (const { page, href, reason } of broken) {
    process.stderr.write(`${page}: ${href} — ${reason}\n`);
  }
  process.stderr.write(`\n${broken.length} broken documentation link(s).\n`);
  process.exit(1);
}
process.stdout.write("Documentation anchors: every cross-page link resolves.\n");
