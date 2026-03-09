/**
 * Import a skill from a .zip file.
 *
 * Extracts SKILL.md from the zip, validates its frontmatter, and returns
 * the workspace file path and content for the caller to create.
 */

import { parseSkillFrontmatter } from './skill-parser.js';
import JSZip from 'jszip';

const MAX_ZIP_SIZE = 1 * 1024 * 1024; // 1 MB

const toKebabCase = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

interface SkillImportResult {
  name: string;
  path: string;
  content: string;
}

/**
 * Import a skill from a zip file.
 *
 * The zip must contain exactly one SKILL.md at the root or inside a single
 * top-level directory (e.g., `my-skill/SKILL.md`).
 *
 * @throws Error on validation failure
 */
const importSkillFromZip = async (file: File): Promise<SkillImportResult> => {
  if (file.size > MAX_ZIP_SIZE) {
    throw new Error(`Zip file too large (${Math.round(file.size / 1024)}KB). Maximum is 1MB.`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);

  // Find all SKILL.md files in the zip
  const skillFiles: { path: string; dir: string | null }[] = [];
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const filename = relativePath.split('/').pop();
    if (filename?.toUpperCase() === 'SKILL.MD') {
      const parts = relativePath.split('/');
      const dir = parts.length > 1 ? parts[0] : null;
      skillFiles.push({ path: relativePath, dir });
    }
  });

  if (skillFiles.length === 0) {
    throw new Error('No SKILL.md found in zip file.');
  }

  if (skillFiles.length > 1) {
    throw new Error('Multiple SKILL.md files found in zip. Expected exactly one.');
  }

  const entry = skillFiles[0];
  const zipFile = zip.file(entry.path);
  if (!zipFile) {
    throw new Error('Failed to read SKILL.md from zip.');
  }

  const content = await zipFile.async('string');
  const metadata = parseSkillFrontmatter(content);

  if (!metadata) {
    throw new Error('SKILL.md has invalid or missing frontmatter. Required: name, description.');
  }

  // Derive skill name from directory name in zip, or kebab-cased frontmatter name
  const skillName = entry.dir ? toKebabCase(entry.dir) : toKebabCase(metadata.name);

  if (!skillName) {
    throw new Error('Could not derive skill name from zip contents or frontmatter.');
  }

  return {
    name: metadata.name,
    path: `skills/${skillName}/SKILL.md`,
    content,
  };
};

export type { SkillImportResult };
export { importSkillFromZip };
