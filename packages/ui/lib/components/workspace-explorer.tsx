import { MarkdownEditor } from './editors/markdown-editor';
import { Button, Input, ScrollArea } from './ui';
import { TreeNode } from './workspace-tree-node';
import { buildFileTree } from '../build-file-tree';
import {
  listUserWorkspaceFiles,
  listAgentMemoryFiles,
  updateWorkspaceFile,
  deleteWorkspaceFile,
  createWorkspaceFile,
} from '@extension/storage';
import { isSkillFile } from '@extension/shared';
import { ArrowLeftIcon, EyeIcon, AlertTriangleIcon, PlusIcon, SaveIcon, TrashIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DbWorkspaceFile } from '@extension/storage';

type WorkspaceExplorerProps = {
  onWorkspaceChanged?: () => void;
};

const WorkspaceExplorer = ({ onWorkspaceChanged }: WorkspaceExplorerProps) => {
  const [userFiles, setUserFiles] = useState<DbWorkspaceFile[]>([]);
  const [agentFiles, setAgentFiles] = useState<DbWorkspaceFile[]>([]);
  const [editingFile, setEditingFile] = useState<DbWorkspaceFile | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const loadFiles = useCallback(async () => {
    const [user, agent] = await Promise.all([listUserWorkspaceFiles(), listAgentMemoryFiles()]);
    setUserFiles(user);
    setAgentFiles(agent);
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const userTree = useMemo(() => buildFileTree(userFiles), [userFiles]);
  const agentTree = useMemo(() => buildFileTree(agentFiles), [agentFiles]);

  const handleToggleFolder = useCallback((path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleToggle = useCallback(
    async (file: DbWorkspaceFile) => {
      await updateWorkspaceFile(file.id, { enabled: !file.enabled });
      await loadFiles();
      onWorkspaceChanged?.();
    },
    [loadFiles, onWorkspaceChanged],
  );

  const handleDelete = useCallback(
    async (file: DbWorkspaceFile) => {
      await deleteWorkspaceFile(file.id);
      await loadFiles();
      onWorkspaceChanged?.();
    },
    [loadFiles, onWorkspaceChanged],
  );

  const handleEdit = useCallback((file: DbWorkspaceFile) => {
    setEditingFile(file);
    setViewOnly(false);
  }, []);

  const handleView = useCallback((file: DbWorkspaceFile) => {
    setEditingFile(file);
    setViewOnly(true);
  }, []);

  const handleNewFile = useCallback(async () => {
    const now = Date.now();
    const file: DbWorkspaceFile = {
      id: nanoid(),
      name: 'untitled.md',
      content: '',
      enabled: true,
      owner: 'user',
      predefined: false,
      createdAt: now,
      updatedAt: now,
    };
    await createWorkspaceFile(file);
    await loadFiles();
    setEditingFile(file);
    setViewOnly(false);
  }, [loadFiles]);

  const handleEditorBack = useCallback(() => {
    setEditingFile(null);
    loadFiles();
    onWorkspaceChanged?.();
  }, [loadFiles, onWorkspaceChanged]);

  /* ── Inline editor ────────────────────────────────────────────── */

  const [editorName, setEditorName] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset editor state when editingFile changes
  useEffect(() => {
    if (editingFile) {
      setEditorName(editingFile.name);
      setEditorContent(editingFile.content);
      setIsDirty(false);
    }
  }, [editingFile]);

  const saveEditor = useCallback(async () => {
    if (viewOnly || !editingFile) return;
    await updateWorkspaceFile(editingFile.id, { name: editorName, content: editorContent });
    setIsDirty(false);
  }, [editingFile, editorName, editorContent, viewOnly]);

  // Auto-save on content change (debounced 500ms)
  useEffect(() => {
    if (!isDirty || viewOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveEditor();
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [isDirty, saveEditor, viewOnly]);

  const handleEditorContentChange = useCallback((value: string) => {
    setEditorContent(value);
    setIsDirty(true);
  }, []);

  const handleEditorNameChange = useCallback((value: string) => {
    setEditorName(value);
    setIsDirty(true);
  }, []);

  const handleEditorDelete = useCallback(async () => {
    if (!editingFile) return;
    await deleteWorkspaceFile(editingFile.id);
    handleEditorBack();
  }, [editingFile, handleEditorBack]);

  if (editingFile) {
    const charCount = editorContent.length;
    const tokenEstimate = Math.ceil(charCount / 4);
    const wasSkillFile = isSkillFile(editingFile.name);
    const isStillSkillFile = isSkillFile(editorName);
    const skillNameWarning = wasSkillFile && !isStillSkillFile;

    return (
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button onClick={handleEditorBack} size="sm" variant="ghost">
            <ArrowLeftIcon className="size-4" />
          </Button>
          {viewOnly ? (
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <EyeIcon className="text-muted-foreground size-4" />
              {editingFile.name}
            </div>
          ) : (
            <Input
              className="h-7 text-sm"
              disabled={editingFile.predefined}
              onChange={e => handleEditorNameChange(e.target.value)}
              value={editorName}
            />
          )}
          {skillNameWarning && (
            <span
              className="text-destructive flex items-center gap-1 text-xs"
              title="This file will no longer be treated as a skill">
              <AlertTriangleIcon className="size-3.5" />
              Not a skill path
            </span>
          )}
          <div className="flex-1" />
          {!viewOnly && (
            <Button disabled={!isDirty} onClick={saveEditor} size="sm" variant="ghost">
              <SaveIcon className="size-4" />
            </Button>
          )}
          {!editingFile.predefined && (
            <Button onClick={handleEditorDelete} size="sm" variant="ghost">
              <TrashIcon className="text-destructive size-4" />
            </Button>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor
            content={editorContent}
            onChange={viewOnly ? undefined : handleEditorContentChange}
            showToolbar={!viewOnly}
          />
        </div>

        {/* Footer */}
        <div className="text-muted-foreground flex items-center justify-between border-t px-3 py-1.5 text-xs">
          <span>
            {charCount.toLocaleString()} chars / ~{tokenEstimate.toLocaleString()} tokens
          </span>
          {isDirty && !viewOnly && <span className="text-yellow-600">Unsaved</span>}
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 py-2">
        {/* User files section */}
        <div>
          <h3 className="text-muted-foreground mb-1 px-3 text-xs font-medium uppercase tracking-wide">
            Your Files
          </h3>
          {userFiles.length === 0 && (
            <p className="text-muted-foreground px-3 py-2 text-sm">No workspace files</p>
          )}
          {userTree.map(node => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expandedFolders={expandedFolders}
              onToggleFolder={handleToggleFolder}
              onEditFile={handleEdit}
              onToggleFile={handleToggle}
              onDeleteFile={handleDelete}
            />
          ))}
        </div>

        {/* Agent memory section */}
        {agentFiles.length > 0 && (
          <div>
            <h3 className="text-muted-foreground mb-1 px-3 text-xs font-medium uppercase tracking-wide">
              Agent Memory
            </h3>
            {agentTree.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
                onViewFile={handleView}
                onToggleFile={handleToggle}
                onDeleteFile={handleDelete}
              />
            ))}
          </div>
        )}

        {/* New file button */}
        <div className="px-3">
          <Button className="w-full" onClick={handleNewFile} size="sm" variant="outline">
            <PlusIcon className="mr-1 size-4" />
            New File
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
};

export { WorkspaceExplorer };
