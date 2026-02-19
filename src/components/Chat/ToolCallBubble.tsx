// ═══════════════════════════════════════════════════════════
// ToolCallBubble — Intent-first tool call display
// Shows tool name + key params + result in a compact card
// ═══════════════════════════════════════════════════════════

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export interface ToolCallInfo {
  toolName: string;
  input?: Record<string, any>;
  output?: string;
  status: 'running' | 'done' | 'error';
  durationMs?: number;
}

// ── Tool icon + color mapping ─────────────────────────────
const TOOL_META: Record<string, { icon: string; label: string; color: string }> = {
  // Search & web
  web_search:    { icon: '🔍', label: 'Web Search',    color: 'var(--aegis-accent)' },
  web_fetch:     { icon: '🌐', label: 'Web Fetch',     color: 'var(--aegis-accent)' },
  browser:       { icon: '🖥️', label: 'Browser',       color: 'var(--aegis-accent)' },
  // File system
  Read:          { icon: '📄', label: 'Read',          color: 'var(--aegis-primary)' },
  Write:         { icon: '✍️', label: 'Write',         color: 'var(--aegis-primary)' },
  Edit:          { icon: '✏️', label: 'Edit',          color: 'var(--aegis-primary)' },
  // Execution
  exec:          { icon: '⚡', label: 'Exec',          color: 'var(--aegis-warning)' },
  process:       { icon: '⚙️', label: 'Process',       color: 'var(--aegis-warning)' },
  // Memory
  memory_search: { icon: '🧠', label: 'Memory Search', color: 'var(--aegis-success)' },
  memory_get:    { icon: '🧠', label: 'Memory Get',    color: 'var(--aegis-success)' },
  // AI / agents
  sessions_spawn:  { icon: '🤖', label: 'Spawn Agent', color: 'var(--aegis-danger)' },
  sessions_send:   { icon: '📨', label: 'Send Message', color: 'var(--aegis-danger)' },
  session_status:  { icon: '📊', label: 'Status',      color: 'var(--aegis-success)' },
  // Cron
  cron:          { icon: '⏰', label: 'Cron',          color: 'var(--aegis-accent)' },
  // Misc
  image:         { icon: '🖼️', label: 'Image',         color: 'var(--aegis-accent)' },
  tts:           { icon: '🔊', label: 'TTS',           color: 'var(--aegis-accent)' },
  gateway:       { icon: '🛡️', label: 'Gateway',       color: 'var(--aegis-primary)' },
  message:       { icon: '💬', label: 'Message',       color: 'var(--aegis-accent)' },
};

function getToolMeta(name: string) {
  return TOOL_META[name] || { icon: '🔧', label: name, color: 'var(--aegis-text-dim)' };
}

/** Summarize input params into a short readable string */
function summarizeInput(toolName: string, input: Record<string, any>): string {
  if (!input || Object.keys(input).length === 0) return '';

  // Tool-specific summaries
  const query = input.query || input.q || input.url || input.path || input.file_path
    || input.command || input.message || input.text || input.task;

  if (query && typeof query === 'string') {
    const truncated = query.length > 60 ? query.slice(0, 57) + '…' : query;
    return `"${truncated}"`;
  }

  // Generic: show first key=value pair
  const first = Object.entries(input)[0];
  if (first) {
    const val = typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]);
    const truncated = val.length > 50 ? val.slice(0, 47) + '…' : val;
    return `${first[0]}: ${truncated}`;
  }

  return '';
}

/** Format output preview (first non-empty line, max 80 chars) */
function previewOutput(output: string): string {
  if (!output) return '';
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const first = lines[0];
  return first.length > 80 ? first.slice(0, 77) + '…' : first;
}

// ── Component ─────────────────────────────────────────────
interface ToolCallBubbleProps {
  tool: ToolCallInfo;
}

export function ToolCallBubble({ tool }: ToolCallBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const meta = getToolMeta(tool.toolName);
  const summary = tool.input ? summarizeInput(tool.toolName, tool.input) : '';
  const outputPreview = tool.output ? previewOutput(tool.output) : '';
  const hasDetails = !!(tool.input && Object.keys(tool.input).length > 0) || !!tool.output;

  return (
    <div className="px-5 py-0.5">
      <div
        className={clsx(
          'group rounded-xl overflow-hidden transition-all duration-200',
          'border border-[rgb(var(--aegis-overlay)/0.06)]',
          'bg-[rgb(var(--aegis-overlay)/0.025)]',
          hasDetails && 'cursor-pointer hover:border-[rgb(var(--aegis-overlay)/0.12)]'
        )}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        {/* ── Main row ── */}
        <div className="flex items-center gap-2.5 px-3 py-2">
          {/* Icon */}
          <span className="text-[14px] shrink-0">{meta.icon}</span>

          {/* Tool name + summary */}
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-[11px] font-mono font-semibold text-aegis-text-secondary shrink-0"
              style={{ color: `rgb(${meta.color})` }}>
              {meta.label}
            </span>
            {summary && (
              <span className="text-[10px] text-aegis-text-dim truncate">{summary}</span>
            )}
          </div>

          {/* Status */}
          <div className="flex items-center gap-1.5 shrink-0">
            {tool.status === 'running' && (
              <span className="flex items-center gap-1 text-[9px] text-aegis-warning font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-aegis-warning animate-pulse" />
                running
              </span>
            )}
            {tool.status === 'done' && (
              <span className="text-[9px] text-aegis-success/60 font-mono">✓ done</span>
            )}
            {tool.status === 'error' && (
              <span className="text-[9px] text-aegis-danger/60 font-mono">✗ error</span>
            )}
            {tool.durationMs !== undefined && tool.status === 'done' && (
              <span className="text-[9px] text-aegis-text-dim font-mono">
                {tool.durationMs < 1000
                  ? `${tool.durationMs}ms`
                  : `${(tool.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
            {hasDetails && (
              expanded
                ? <ChevronDown size={10} className="text-aegis-text-dim" />
                : <ChevronRight size={10} className="text-aegis-text-dim" />
            )}
          </div>
        </div>

        {/* ── Output preview (collapsed) ── */}
        {!expanded && outputPreview && (
          <div className="px-3 pb-1.5">
            <span className="text-[10px] text-aegis-text-dim/50 font-mono truncate block"
              dir="ltr">
              {outputPreview}
            </span>
          </div>
        )}

        {/* ── Expanded details ── */}
        {expanded && hasDetails && (
          <div className="border-t border-[rgb(var(--aegis-overlay)/0.06)] px-3 py-2 space-y-2">
            {/* Input */}
            {tool.input && Object.keys(tool.input).length > 0 && (
              <div>
                <div className="text-[9px] text-aegis-text-dim uppercase tracking-wider mb-1">Input</div>
                <pre className="text-[10px] font-mono text-aegis-text-muted whitespace-pre-wrap break-all
                  bg-[rgb(var(--aegis-overlay)/0.04)] rounded-lg p-2 max-h-[120px] overflow-auto"
                  dir="ltr">
                  {JSON.stringify(tool.input, null, 2)}
                </pre>
              </div>
            )}
            {/* Output */}
            {tool.output && (
              <div>
                <div className="text-[9px] text-aegis-text-dim uppercase tracking-wider mb-1">Output</div>
                <pre className="text-[10px] font-mono text-aegis-text-muted whitespace-pre-wrap break-all
                  bg-[rgb(var(--aegis-overlay)/0.04)] rounded-lg p-2 max-h-[200px] overflow-auto"
                  dir="ltr">
                  {tool.output.length > 1000
                    ? tool.output.slice(0, 1000) + '\n…(truncated)'
                    : tool.output}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
