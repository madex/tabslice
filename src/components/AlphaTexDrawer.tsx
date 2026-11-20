import React from 'react';
import {Play, RotateCcw, X} from 'lucide-react';

interface AlphaTexDrawerProps {
  isOpen: boolean;
  value: string;
  onChange: (val: string) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
  errorMessage: string | null;
}

export const AlphaTexDrawer: React.FC<AlphaTexDrawerProps> = ({
  isOpen,
  value,
  onChange,
  onApply,
  onReset,
  onClose,
  errorMessage,
}) => {
  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      onApply();
    }
  };

  return (
    <aside className="w-full md:w-[380px] lg:w-[420px] shrink-0 bg-[#14161A] text-zinc-100 border-l border-white/10 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-11 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-zinc-100 whitespace-nowrap">
            alphaTex Editor
          </span>
          <span className="text-[11px] text-zinc-400 font-mono hidden sm:inline">
            Ctrl+Enter
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onReset}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Zurücksetzen"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onApply}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors whitespace-nowrap"
          >
            <Play className="w-3 h-3 fill-current" />
            Rendern
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Editor schließen"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="px-4 py-2 bg-red-500/15 border-b border-red-500/30 text-xs text-red-200 font-mono">
          {errorMessage}
        </div>
      )}

      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="flex-1 w-full p-4 bg-[#14161A] text-zinc-200 font-mono text-xs leading-relaxed resize-none focus:outline-none score-scroll"
        placeholder="alphaTex Notation eingeben..."
      />
    </aside>
  );
};
