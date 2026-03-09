import type { ChannelInboundMessage } from '../types';
import type { TgUpdate } from './types';

/** Normalized result including the channel-specific offset for dedup */
interface NormalizedUpdate {
  message: ChannelInboundMessage;
  offset: number;
}

/** Convert a Telegram update to a channel-agnostic inbound message, or null if not applicable */
const normalizeTelegramUpdate = (update: TgUpdate): NormalizedUpdate | null => {
  const msg = update.message;
  if (!msg) return null;

  // Must have a sender
  if (!msg.from) return null;

  // Support text messages and voice messages
  const hasText = !!msg.text;
  const hasVoice = !!msg.voice;
  if (!hasText && !hasVoice) return null;

  return {
    message: {
      channelMessageId: String(msg.message_id),
      channelChatId: String(msg.chat.id),
      senderId: String(msg.from.id),
      senderName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || undefined,
      senderUsername: msg.from.username,
      body: msg.text ?? '',
      timestamp: msg.date * 1000,
      chatType: msg.chat.type === 'private' ? 'direct' : 'group',
      replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      ...(msg.voice
        ? { mediaFileId: msg.voice.file_id, mediaMimeType: msg.voice.mime_type ?? 'audio/ogg' }
        : {}),
    },
    offset: update.update_id,
  };
};

export { normalizeTelegramUpdate };
export type { NormalizedUpdate };
