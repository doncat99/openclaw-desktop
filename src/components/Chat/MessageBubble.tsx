import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, User, RotateCcw, Eye, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getDirection } from '@/i18n';
import { CodeBlock } from './CodeBlock';
import { ChatImage } from './ChatImage';
import { ChatVideo } from './ChatVideo';
import { AudioPlayer } from './AudioPlayer';
import type { ChatMessage } from '@/stores/chatStore';
import { autoDetectCode } from '@/utils/autoDetectCode';
import clsx from 'clsx';

// ── Artifact Parser ──
interface ParsedArtifact {
  type: string;
  title: string;
  content: string;
}

function parseArtifacts(text: string): { parts: Array<{ kind: 'text' | 'artifact'; text?: string; artifact?: ParsedArtifact }>} {
  const regex = /<aegis_artifact\s+type="([^"]+)"\s+title="([^"]*)">([\s\S]*?)<\/aegis_artifact>/g;
  const parts: Array<{ kind: 'text' | 'artifact'; text?: string; artifact?: ParsedArtifact }> = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Text before artifact
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) parts.push({ kind: 'text', text: before });
    }
    // Artifact
    parts.push({
      kind: 'artifact',
      artifact: {
        type: match[1],
        title: match[2],
        content: match[3].trim(),
      },
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last artifact
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) parts.push({ kind: 'text', text: remaining });
  }

  // No artifacts found — return full text
  if (parts.length === 0) {
    parts.push({ kind: 'text', text });
  }

  return { parts };
}

// ── Artifact Card Component ──
function ArtifactCard({ artifact }: { artifact: ParsedArtifact }) {
  const [opening, setOpening] = useState(false);

  const typeIcons: Record<string, string> = {
    html: '🌐', react: '⚛️', svg: '🎨', mermaid: '📊', code: '📝',
  };

  const handleOpen = async () => {
    setOpening(true);
    try {
      await window.aegis?.artifact?.open(artifact);
    } catch (err) {
      console.error('[Artifact] Failed to open preview:', err);
    } finally {
      setTimeout(() => setOpening(false), 500);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-aegis-primary/20 bg-aegis-primary/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-aegis-primary/10">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">{typeIcons[artifact.type] || '📄'}</span>
          <div>
            <div className="text-[13px] font-medium text-aegis-text">{artifact.title}</div>
            <div className="text-[10px] text-aegis-text-dim uppercase tracking-wider">{artifact.type}</div>
          </div>
        </div>
        <button
          onClick={handleOpen}
          disabled={opening}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
            'bg-aegis-primary/15 text-aegis-primary hover:bg-aegis-primary/25',
            'border border-aegis-primary/20 hover:border-aegis-primary/40',
            opening && 'opacity-60'
          )}
        >
          <Eye size={13} />
          Preview
        </button>
      </div>
      {/* Code preview (collapsed) */}
      <details className="group">
        <summary className="px-4 py-1.5 text-[11px] text-aegis-text-dim cursor-pointer hover:text-aegis-text-muted flex items-center gap-1.5 select-none">
          <Code2 size={11} />
          View source ({artifact.content.length} chars)
        </summary>
        <div className="px-4 pb-3 max-h-[200px] overflow-auto">
          <pre className="text-[11px] text-aegis-text-dim font-mono whitespace-pre-wrap bg-[rgb(var(--aegis-overlay)/0.08)] rounded-lg p-3">
            {artifact.content.slice(0, 2000)}{artifact.content.length > 2000 ? '\n...(truncated)' : ''}
          </pre>
        </div>
      </details>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Message Bubble — Colors fixed for dark theme visibility
// ═══════════════════════════════════════════════════════════

interface MessageBubbleProps {
  message: ChatMessage;
  onResend?: (content: string) => void;
}

// ── Shared Markdown Components ──
const markdownComponents = {
  table({ children }: any) {
    return (
      <div className="table-wrapper">
        <table>{children}</table>
      </div>
    );
  },
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      return <CodeBlock language={match?.[1] || ''} code={codeString} />;
    }
    return (
      <code
        className="text-[13px] font-mono px-1.5 py-0.5 rounded"
        style={{ background: 'rgb(var(--aegis-primary) / 0.12)', color: 'rgb(var(--aegis-primary))' }}
        {...props}
      >
        {children}
      </code>
    );
  },
  img({ src, alt }: any) {
    if (!src) return null;
    // Check if it's a video by extension
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (videoExtensions.test(src)) {
      return <ChatVideo src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
    }
    return <ChatImage src={src} alt={alt} maxWidth="100%" maxHeight="400px" />;
  },
  a({ href, children }: any) {
    // Check if link is a video
    const videoExtensions = /\.(mp4|webm|mov|avi|mkv|m4v|ogg)(\?.*)?$/i;
    if (href && videoExtensions.test(href)) {
      return <ChatVideo src={href} alt={String(children) || 'video'} maxWidth="100%" maxHeight="400px" />;
    }
    return (
      <a
        href={href}
        onClick={(e) => { e.preventDefault(); if (href) window.open(href, '_blank'); }}
        className="text-aegis-primary hover:text-aegis-primary/70 underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
};

export const MessageBubble = memo(function MessageBubble({ message, onResend }: MessageBubbleProps) {
  const { t, i18n } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const isUser = message.role === 'user';
  const isStreaming = message.isStreaming;
  const dir = getDirection(i18n.language);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const extractText = (val: any): string => {
    if (typeof val === 'string') return val;
    if (val == null) return '';
    if (Array.isArray(val)) {
      return val.map((b: any) => {
        if (typeof b === 'string') return b;
        if (b?.type === 'text' && typeof b.text === 'string') return b.text;
        if (typeof b?.text === 'string') return b.text;
        return '';
      }).join('');
    }
    if (typeof val === 'object') {
      if (typeof val.text === 'string') return val.text;
      if (typeof val.content === 'string') return val.content;
      if (Array.isArray(val.content)) return extractText(val.content);
      return JSON.stringify(val);
    }
    return String(val);
  };

  const rawContent = extractText(message.content);

  const cleanContent = isUser
    ? rawContent.replace(/^\[.*?\]\s*/, '').replace(/\n\[message_id:.*?\]$/, '')
    : autoDetectCode(rawContent);

  const timeStr = (() => {
    try {
      const d = new Date(message.timestamp);
      if (isNaN(d.getTime())) return '';
      const locale = i18n.language?.startsWith('ar') ? 'ar-SA' : 'en-US';
      return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  })();

  return (
    <div
      className={clsx(
        'group flex items-start gap-3 px-5 py-1.5 transition-colors',
        isUser ? 'flex-row-reverse' : '',
        !isUser && 'hover:bg-[rgb(var(--aegis-overlay)/0.015)]'
      )}
      dir={dir}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Avatar */}
      {isUser ? (
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-aegis-primary/15 border border-aegis-primary/25">
          <User size={14} className="text-aegis-primary" />
        </div>
      ) : (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-aegis-primary to-aegis-accent flex items-center justify-center shrink-0 mt-0.5 shadow-glow-sm">
          <span className="text-[10px] font-bold text-aegis-text">A</span>
        </div>
      )}

      {/* Message Content */}
      <div className={clsx('flex flex-col max-w-[80%] min-w-0', isUser && 'items-end')}>
        {/* Bubble */}
        <div
          className={clsx(
            'rounded-2xl px-4 py-2.5 relative',
            isUser
              ? 'rounded-tl-md bg-aegis-primary/[0.12] border border-aegis-primary/20'
              : 'rounded-tr-md bg-[rgb(var(--aegis-overlay)/0.04)] border border-[rgb(var(--aegis-overlay)/0.06)]',
            isStreaming && 'border-aegis-primary/30'
          )}
        >
          {/* Streaming shimmer */}
          {isStreaming && (
            <div className="absolute -top-px left-0 right-0 h-[2px] overflow-hidden rounded-full">
              <div className="w-full h-full bg-gradient-to-r from-transparent via-aegis-primary/50 to-transparent animate-shimmer bg-[length:200%_100%]" />
            </div>
          )}

          {/* Audio Player */}
          {message.mediaUrl && !isStreaming && (
            <div className="mb-2">
              <AudioPlayer src={message.mediaUrl} />
            </div>
          )}

          {/* Attached images */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {message.attachments
                .filter((att) => att.mimeType?.startsWith('image/'))
                .map((att, i) => (
                  <ChatImage
                    key={i}
                    src={att.content}
                    alt={att.fileName || t('media.attachment')}
                    maxWidth="280px"
                    maxHeight="200px"
                  />
                ))}
            </div>
          )}

          {isUser ? (
            <div className="markdown-body text-[14px] leading-relaxed text-aegis-text">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {cleanContent}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="markdown-body text-[14px] leading-relaxed text-aegis-text">
              {(() => {
                // Check for artifacts in assistant messages
                const hasArtifacts = cleanContent.includes('<aegis_artifact');
                if (hasArtifacts) {
                  const { parts } = parseArtifacts(cleanContent);
                  return parts.map((part, idx) => {
                    if (part.kind === 'artifact' && part.artifact) {
                      return <ArtifactCard key={`art-${idx}`} artifact={part.artifact} />;
                    }
                    // Render text parts as markdown
                    return (
                      <ReactMarkdown key={`txt-${idx}`} remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {part.text || ''}
                      </ReactMarkdown>
                    );
                  });
                }

                // Normal markdown rendering (no artifacts)
                try {
                  return (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {cleanContent}
                    </ReactMarkdown>
                  );
                } catch {
                  return <p className="whitespace-pre-wrap">{cleanContent}</p>;
                }
              })()}
            </div>
          )}
        </div>

        {/* Footer — Time + Actions (more visible) */}
        <div className="flex items-center gap-2 mt-1 px-1 h-5">
          <span className="text-[10px] text-aegis-text-muted font-mono">{timeStr}</span>

          {showActions && !isStreaming && (
            <div className="flex items-center gap-0.5 animate-fade-in">
              <button
                onClick={handleCopy}
                className="p-1 rounded-md hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                title={t('chat.copy')}
              >
                {copied ? (
                  <Check size={11} className="text-emerald-400" />
                ) : (
                  <Copy size={11} className="text-aegis-text-muted hover:text-aegis-text-secondary" />
                )}
              </button>
              {isUser && onResend && (
                <button
                  onClick={() => onResend(cleanContent)}
                  className="p-1 rounded-md hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors"
                  title={t('chat.resend')}
                >
                  <RotateCcw size={11} className="text-aegis-text-muted hover:text-aegis-text-secondary" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
