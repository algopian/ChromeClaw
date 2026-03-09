import { Type } from '@sinclair/typebox';
import type { Static } from '@sinclair/typebox';

const createDocumentSchema = Type.Object({
  title: Type.String({ description: 'Title of the document' }),
  kind: Type.Union(
    [Type.Literal('text'), Type.Literal('code'), Type.Literal('sheet'), Type.Literal('image')],
    { description: 'The kind of document to create: text, code, sheet, or image' },
  ),
  content: Type.String({ description: 'The full document content' }),
});

type CreateDocumentArgs = Static<typeof createDocumentSchema>;

/**
 * Create document returns metadata + content for storage.
 */
const executeCreateDocument = async (
  args: CreateDocumentArgs,
): Promise<{ id: string; title: string; kind: string; content: string }> => {
  const { nanoid } = await import('nanoid');
  return {
    id: nanoid(),
    title: args.title,
    kind: args.kind,
    content: args.content,
  };
};

export { createDocumentSchema, executeCreateDocument };
export type { CreateDocumentArgs };
