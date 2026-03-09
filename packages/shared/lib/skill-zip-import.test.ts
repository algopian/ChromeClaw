import { importSkillFromZip } from './skill-zip-import';
import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';

const VALID_SKILL_MD = `---
name: My Test Skill
description: A test skill
---

# My Test Skill

Instructions here.
`;

const createZipFile = async (
  files: Record<string, string>,
  sizeOverride?: number,
): Promise<File> => {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const file = new File([blob], 'test.zip', { type: 'application/zip' });
  if (sizeOverride) {
    Object.defineProperty(file, 'size', { value: sizeOverride });
  }
  return file;
};

describe('importSkillFromZip', () => {
  it('extracts SKILL.md from root of zip', async () => {
    const file = await createZipFile({ 'SKILL.md': VALID_SKILL_MD });
    const result = await importSkillFromZip(file);
    expect(result.name).toBe('My Test Skill');
    expect(result.content).toBe(VALID_SKILL_MD);
    expect(result.path).toBe('skills/my-test-skill/SKILL.md');
  });

  it('extracts SKILL.md from single top-level directory', async () => {
    const file = await createZipFile({ 'my-cool-skill/SKILL.md': VALID_SKILL_MD });
    const result = await importSkillFromZip(file);
    expect(result.name).toBe('My Test Skill');
    expect(result.content).toBe(VALID_SKILL_MD);
  });

  it('derives skill name from directory name in zip', async () => {
    const file = await createZipFile({ 'Custom Skill Name/SKILL.md': VALID_SKILL_MD });
    const result = await importSkillFromZip(file);
    expect(result.path).toBe('skills/custom-skill-name/SKILL.md');
  });

  it('falls back to kebab-cased frontmatter name when no directory', async () => {
    const file = await createZipFile({ 'SKILL.md': VALID_SKILL_MD });
    const result = await importSkillFromZip(file);
    expect(result.path).toBe('skills/my-test-skill/SKILL.md');
  });

  it('rejects zip without SKILL.md', async () => {
    const file = await createZipFile({ 'README.md': '# Hello' });
    await expect(importSkillFromZip(file)).rejects.toThrow('No SKILL.md found');
  });

  it('rejects zip with multiple SKILL.md files', async () => {
    const file = await createZipFile({
      'skill-a/SKILL.md': VALID_SKILL_MD,
      'skill-b/SKILL.md': VALID_SKILL_MD,
    });
    await expect(importSkillFromZip(file)).rejects.toThrow('Multiple SKILL.md');
  });

  it('rejects zip exceeding 1 MB', async () => {
    const file = await createZipFile({ 'SKILL.md': VALID_SKILL_MD }, 2 * 1024 * 1024);
    await expect(importSkillFromZip(file)).rejects.toThrow('too large');
  });

  it('rejects SKILL.md with invalid frontmatter', async () => {
    const badContent = '# Just a markdown file\n\nNo frontmatter.';
    const file = await createZipFile({ 'SKILL.md': badContent });
    await expect(importSkillFromZip(file)).rejects.toThrow('invalid or missing frontmatter');
  });

  it('returns correct workspace file path (skills/{name}/SKILL.md)', async () => {
    const file = await createZipFile({ 'web-research/SKILL.md': VALID_SKILL_MD });
    const result = await importSkillFromZip(file);
    expect(result.path).toBe('skills/web-research/SKILL.md');
  });
});
