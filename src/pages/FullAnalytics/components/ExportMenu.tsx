// ═══════════════════════════════════════════════════════════
// ExportMenu — Dropdown with CSV download + clipboard copy
// ═══════════════════════════════════════════════════════════

import { useState } from 'react';
import { Download, FileText, Copy, Check } from 'lucide-react';

interface ExportMenuProps {
  onExportCSV: () => void;
  onCopyText: () => void;
}

export function ExportMenu({ onExportCSV, onCopyText }: ExportMenuProps) {
  const [open, setOpen]     = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    onCopyText();
    setCopied(true);
    setOpen(false);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] transition-colors border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.03)] text-aegis-text-muted hover:text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]"
      >
        {copied
          ? <Check size={14} className="text-aegis-success" />
          : <Download size={14} />}
        <span>{copied ? 'Copied!' : 'Export'}</span>
      </button>

      {open && (
        <>
          {/* Backdrop to close menu on outside click */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute end-0 top-full mt-1 z-50 w-44 rounded-xl border border-[rgb(var(--aegis-overlay)/0.1)] overflow-hidden"
            style={{
              background:       'rgba(13,17,23,0.97)',
              backdropFilter:   'blur(20px)',
              boxShadow:        '0 8px 32px rgb(var(--aegis-overlay) / 0.15)',
            }}
          >
            <button
              onClick={() => { onExportCSV(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[rgb(var(--aegis-overlay)/0.05)] text-[12px] text-aegis-text-muted text-start transition-colors"
            >
              <FileText size={14} className="text-aegis-accent shrink-0" />
              <span>Download CSV</span>
            </button>
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[rgb(var(--aegis-overlay)/0.05)] text-[12px] text-aegis-text-muted text-start transition-colors"
            >
              <Copy size={14} className="text-aegis-primary shrink-0" />
              <span>Copy Summary</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
