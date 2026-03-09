import { t, useT } from '@extension/i18n';
import { importSkillFromZip, parseSkillFrontmatter } from '@extension/shared';
import {
  listSkillFiles,
  listWorkspaceFiles,
  createWorkspaceFile,
  updateWorkspaceFile,
  deleteWorkspaceFile,
} from '@extension/storage';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
} from '@extension/ui';
import {
  ZapIcon,
  PlusIcon,
  UploadIcon,
  TrashIcon,
  AlertTriangleIcon,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { DbWorkspaceFile } from '@extension/storage';
import { SKILL_TEMPLATE, getSkillDisplayName } from './skill-display-utils.js';
import type { SkillWithMeta } from './skill-display-utils.js';

const SkillConfig = () => {
  const t = useT();
  const [skills, setSkills] = useState<SkillWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadSkills = useCallback(async () => {
    const files = await listSkillFiles();
    const enriched: SkillWithMeta[] = files.map(file => {
      const meta = parseSkillFrontmatter(file.content);
      return {
        file,
        displayName: meta?.name ?? getSkillDisplayName(file.name),
        description: meta?.description ?? '',
      };
    });
    setSkills(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleToggle = useCallback(
    async (file: DbWorkspaceFile) => {
      await updateWorkspaceFile(file.id, { enabled: !file.enabled });
      await loadSkills();
    },
    [loadSkills],
  );

  const handleDelete = useCallback(
    async (file: DbWorkspaceFile) => {
      const meta = parseSkillFrontmatter(file.content);
      const name = meta?.name ?? getSkillDisplayName(file.name);
      if (!window.confirm(t('skill_deleteConfirm', name))) return;
      await deleteWorkspaceFile(file.id);
      await loadSkills();
      toast.success(t('skill_deleted'));
    },
    [loadSkills, t],
  );

  const handleNewSkill = useCallback(async () => {
    const allFiles = await listWorkspaceFiles();
    const existingNames = new Set(allFiles.map(f => f.name));
    let skillName = 'untitled';
    let path = `skills/${skillName}/SKILL.md`;
    let counter = 2;
    while (existingNames.has(path)) {
      skillName = `untitled-${counter}`;
      path = `skills/${skillName}/SKILL.md`;
      counter++;
    }
    const displayName = skillName
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const template = SKILL_TEMPLATE.replace('name: Untitled', `name: ${displayName}`);
    const now = Date.now();
    const file: DbWorkspaceFile = {
      id: nanoid(),
      name: path,
      content: template,
      enabled: true,
      owner: 'user',
      predefined: false,
      createdAt: now,
      updatedAt: now,
    };
    await createWorkspaceFile(file);
    await loadSkills();
  }, [loadSkills]);

  const handleImportSkill = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      try {
        const result = await importSkillFromZip(file);
        const allFiles = await listWorkspaceFiles();
        const existing = allFiles.find(f => f.name === result.path);
        if (existing) {
          toast.error(t('skill_importExists', result.path));
          return;
        }
        const now = Date.now();
        const wsFile: DbWorkspaceFile = {
          id: nanoid(),
          name: result.path,
          content: result.content,
          enabled: true,
          owner: 'user',
          predefined: false,
          createdAt: now,
          updatedAt: now,
        };
        await createWorkspaceFile(wsFile);
        await loadSkills();
        toast.success(t('skill_importedSkill', result.name));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('skill_importFailed'));
      }
    },
    [loadSkills, t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ZapIcon className="size-5 text-amber-500" />
          {t('skill_title')}
        </CardTitle>
        <CardDescription>
          {t('skill_description')}
        </CardDescription>
        <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          {t('skill_browserWarning')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t('skill_installedSkills')}</h3>
          <div className="flex gap-2">
            <Button onClick={handleImportSkill} size="sm" variant="outline">
              <UploadIcon className="mr-1 size-4" /> {t('skill_importZip')}
            </Button>
            <Button onClick={handleNewSkill} size="sm" variant="outline">
              <PlusIcon className="mr-1 size-4" /> {t('skill_newSkill')}
            </Button>
          </div>
        </div>
        {/* Skill list */}
        {loading ? (
          <p className="text-muted-foreground text-sm">{t('skill_loadingSkills')}</p>
        ) : skills.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('skill_noSkills')}</p>
        ) : (
          <div className="divide-y rounded-md border">
            {skills.map(({ file, displayName, description }) => (
              <div className="flex items-center gap-3 px-3 py-2.5" key={file.id}>
                <ZapIcon className="size-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'text-sm font-medium',
                      !file.enabled && 'text-muted-foreground line-through',
                    )}>
                    {displayName}
                  </div>
                  {description && (
                    <p className="text-muted-foreground truncate text-xs">{description}</p>
                  )}
                </div>
                <button
                  className={cn(
                    'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
                    file.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                  onClick={() => handleToggle(file)}
                  title={file.enabled ? 'Disable' : 'Enable'}
                  type="button">
                  {file.enabled ? t('common_on') : t('common_off')}
                </button>
                <div className="flex shrink-0 gap-1">
                  {!file.predefined && (
                    <Button
                      onClick={() => handleDelete(file)}
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive">
                      <TrashIcon className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <input
          accept=".zip"
          className="hidden"
          onChange={handleImportFileSelected}
          ref={importInputRef}
          type="file"
        />
      </CardContent>
    </Card>
  );
};

export { SkillConfig };
