import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';

// ═══════════════════════════════════════════════════════════
// Code Block — Theme-aware (dark/light) matching AEGIS design
// Uses CSS variables: --aegis-code-bg, --aegis-code-header
// ═══════════════════════════════════════════════════════════

interface CodeBlockProps {
  language: string;
  code: string;
}

/** Build syntax theme from base (oneDark/oneLight) with AEGIS overrides */
function buildTheme(base: Record<string, any>) {
  return {
    ...base,
    'pre[class*="language-"]': {
      ...base['pre[class*="language-"]'],
      background: 'var(--aegis-code-bg)',
      margin: 0,
      padding: '1em',
      borderRadius: 0,
      fontSize: '0.87em',
      direction: 'ltr' as const,
      textAlign: 'left' as const,
    },
    'code[class*="language-"]': {
      ...base['code[class*="language-"]'],
      background: 'transparent',
      direction: 'ltr' as const,
      textAlign: 'left' as const,
    },
  };
}

export function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayLang = language || 'text';

  // Pick syntax theme based on current theme
  const isDark = !document.documentElement.classList.contains('light');
  const theme = buildTheme(isDark ? oneDark : oneLight);

  return (
    <div className="my-2 rounded-xl overflow-hidden border border-[rgb(var(--aegis-overlay)/0.08)] group" dir="ltr"
      style={{ background: 'var(--aegis-code-bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-[rgb(var(--aegis-overlay)/0.06)]"
        style={{ background: 'var(--aegis-code-header)' }}>
        <span className="text-[10px] font-mono font-medium text-aegis-text-muted uppercase tracking-widest">
          {displayLang}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-[10px] text-aegis-text-muted hover:text-aegis-text-secondary transition-colors"
          title="نسخ الكود"
        >
          {copied ? (
            <>
              <Check size={11} className="text-emerald-400" />
              <span className="text-emerald-400">تم</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">نسخ</span>
            </>
          )}
        </button>
      </div>

      {/* Code */}
      <SyntaxHighlighter
        language={language || 'text'}
        style={theme}
        showLineNumbers={code.split('\n').length > 3}
        lineNumberStyle={{
          color: 'rgb(var(--aegis-overlay) / 0.12)',
          fontSize: '0.78em',
          paddingRight: '1em',
          minWidth: '2.5em',
          textAlign: 'right',
        }}
        wrapLongLines
        customStyle={{
          background: 'var(--aegis-code-bg)',
          margin: 0,
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
