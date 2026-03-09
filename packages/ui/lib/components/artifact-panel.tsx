import { CodeEditor } from './editors/code-editor';
import { ImageEditor } from './editors/image-editor';
import { MarkdownEditor } from './editors/markdown-editor';
import { SheetEditor } from './editors/sheet-editor';
import { DocumentSkeleton } from './document-skeleton';
import { Button } from './ui';
import { initialArtifactData, useArtifact } from '../hooks/use-artifact';
import { AnimatePresence, motion } from 'framer-motion';
import { CopyIcon, XIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { toast } from 'sonner';

const PureArtifactPanel = () => {
  const { artifact, setArtifact } = useArtifact();

  const handleClose = useCallback(() => {
    setArtifact(current =>
      current.status === 'streaming'
        ? { ...current, isVisible: false }
        : { ...initialArtifactData, status: 'idle' },
    );
  }, [setArtifact]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.content);
    toast.success('Copied to clipboard!');
  }, [artifact.content]);

  const renderContent = () => {
    if (!artifact.content && artifact.status === 'idle') {
      return <DocumentSkeleton artifactKind={artifact.kind} />;
    }

    const commonProps = {
      content: artifact.content,
      status: artifact.status,
      isCurrentVersion: true,
    };

    switch (artifact.kind) {
      case 'text':
        return <MarkdownEditor className="px-4 py-8 md:px-14 md:py-12" content={artifact.content} streaming={artifact.status === 'streaming'} />;
      case 'code':
        return <CodeEditor {...commonProps} />;
      case 'sheet':
        return <SheetEditor {...commonProps} />;
      case 'image':
        return <ImageEditor {...commonProps} isInline={false} title={artifact.title} />;
      default:
        return <MarkdownEditor className="px-4 py-8 md:px-14 md:py-12" content={artifact.content} streaming={artifact.status === 'streaming'} />;
    }
  };

  return (
    <AnimatePresence>
      {artifact.isVisible && (
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="bg-background fixed inset-0 z-50 flex flex-col"
          exit={{ opacity: 0, x: 100 }}
          initial={{ opacity: 0, x: 100 }}>
          {/* Header */}
          <div className="flex items-center justify-between border-b p-2">
            <div className="flex items-center gap-2">
              <Button onClick={handleClose} size="icon-sm" variant="ghost">
                <XIcon className="size-4" />
              </Button>
              <div className="flex flex-col">
                <span className="truncate text-sm font-medium">{artifact.title || 'Untitled'}</span>
                {artifact.status === 'streaming' && (
                  <span className="text-muted-foreground text-xs">Streaming...</span>
                )}
              </div>
            </div>

            <Button
              disabled={!artifact.content || artifact.status === 'streaming'}
              onClick={handleCopy}
              size="icon-sm"
              variant="ghost">
              <CopyIcon className="size-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">{renderContent()}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ArtifactPanel = memo(PureArtifactPanel);

export { ArtifactPanel };
