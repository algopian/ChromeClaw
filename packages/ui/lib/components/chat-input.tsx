import { AttachmentsButton } from './attachments-button';
import { PreviewAttachment } from './preview-attachment';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from './ui';
import { cn } from '../utils';
import { useT } from '@extension/i18n';
import { SendIcon, SquareIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Attachment, ChatModel, StreamingStatus } from '@extension/shared';
import type { ChangeEvent, ClipboardEvent, FormEvent, KeyboardEvent } from 'react';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const ACCEPTED_FILE_TYPES = 'image/*,.pdf,.txt,.md,.csv';

type ChatInputProps = {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (content: string, attachments?: Attachment[]) => void;
  status: StreamingStatus;
  stop: () => void;
  models: ChatModel[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
};

const ChatInput = ({
  input,
  setInput,
  onSubmit,
  status,
  stop,
  models,
  selectedModelId,
  onModelChange,
}: ChatInputProps) => {
  const t = useT();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStreaming = status === 'streaming' || status === 'connecting';
  const isUploading = uploadQueue.length > 0;

  const processFile = useCallback(
    (file: File): Promise<Attachment | null> =>
      new Promise(resolve => {
        if (file.size > MAX_FILE_SIZE) {
          toast.error(t('chat_fileSizeError', file.name));
          resolve(null);
          return;
        }

        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            url: reader.result as string,
            contentType: file.type || 'application/octet-stream',
          });
        };
        reader.onerror = () => {
          toast.error(t('chat_fileReadError', file.name));
          resolve(null);
        };
        reader.readAsDataURL(file);
      }),
    [],
  );

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;

      const totalCount = attachments.length + files.length;
      if (totalCount > MAX_FILES) {
        toast.error(t('chat_maxFilesError', String(MAX_FILES)));
        return;
      }

      const fileNames = files.map(f => f.name);
      setUploadQueue(prev => [...prev, ...fileNames]);

      const results = await Promise.all(files.map(f => processFile(f)));
      const valid = results.filter((r): r is Attachment => r !== null);

      setAttachments(prev => [...prev, ...valid]);
      setUploadQueue(prev => prev.filter(name => !fileNames.includes(name)));

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [attachments.length, processFile],
  );

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const fileItems = items.filter(item => item.kind === 'file' && item.getAsFile() !== null);

      if (fileItems.length === 0) return;

      e.preventDefault();

      if (attachments.length + fileItems.length > MAX_FILES) {
        toast.error(t('chat_maxFilesError', String(MAX_FILES)));
        return;
      }

      const fileNames = fileItems.map((item, i) => {
        const file = item.getAsFile();
        return file?.name || `pasted-file-${i}`;
      });
      setUploadQueue(prev => [...prev, ...fileNames]);

      const results: Attachment[] = [];
      for (const item of fileItems) {
        const file = item.getAsFile();
        if (file) {
          const result = await processFile(file);
          if (result) results.push(result);
        }
      }

      setAttachments(prev => [...prev, ...results]);
      setUploadQueue(prev => prev.filter(name => !fileNames.includes(name)));
    },
    [attachments.length, processFile],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isStreaming) {
      stop();
      return;
    }
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) return;
    onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
    setAttachments([]);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isStreaming && (input.trim() || attachments.length > 0) && !isUploading) {
        onSubmit(input.trim(), attachments.length > 0 ? attachments : undefined);
        setAttachments([]);
      }
    }
  };

  return (
    <form
      className="bg-background w-full overflow-hidden rounded-xl border shadow-sm"
      onSubmit={handleSubmit}>
      {/* Attachment previews */}
      {(attachments.length > 0 || isUploading) && (
        <div
          className="flex gap-2 overflow-x-auto border-b px-3 py-2"
          data-testid="attachments-preview">
          {attachments.map((attachment, index) => (
            <PreviewAttachment
              attachment={attachment}
              key={`${attachment.name}-${index}`}
              onRemove={() => removeAttachment(index)}
            />
          ))}
          {uploadQueue.map(name => (
            <PreviewAttachment
              attachment={{ name, url: '', contentType: '' }}
              isUploading
              key={`uploading-${name}`}
            />
          ))}
        </div>
      )}

      <input
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />

      <Textarea
        className={cn(
          'outline-hidden w-full resize-none rounded-none border-none bg-transparent p-3 shadow-none ring-0',
          'focus-visible:ring-0',
        )}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={t('chat_placeholder')}
        rows={1}
        style={{ fieldSizing: 'content', maxHeight: '164px' } as React.CSSProperties}
        value={input}
      />
      <div className="flex items-center justify-between p-1">
        <div className="flex items-center gap-1">
          <AttachmentsButton disabled={isStreaming} onClick={() => fileInputRef.current?.click()} />
          {models.length > 0 && (
            <Select onValueChange={onModelChange} value={selectedModelId}>
              <SelectTrigger
                className={cn(
                  'text-muted-foreground h-auto border-none bg-transparent px-2 py-1.5 font-medium shadow-none transition-colors',
                  'hover:bg-accent hover:text-foreground',
                )}>
                <SelectValue placeholder={t('chat_modelSelect')} />
              </SelectTrigger>
              <SelectContent>
                {models.map(model => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button
          className="gap-1.5 rounded-lg"
          disabled={isUploading || (!isStreaming && !input.trim() && attachments.length === 0)}
          size="icon"
          type="submit"
          variant="default">
          {isStreaming ? <SquareIcon className="size-4" /> : <SendIcon className="size-4" />}
        </Button>
      </div>
    </form>
  );
};

export { ChatInput };
