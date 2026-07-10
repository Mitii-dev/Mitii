import { useState, useCallback, type CSSProperties, type KeyboardEvent, useRef, useEffect } from 'react';
import type { ThunderMode } from '../../../core/session/ThunderSession';
import type {
  AgentDepthView,
  ApprovalMode,
  ChatImageAttachment,
  ContextPathSuggestion,
  PinnedContextView,
  TokenUsageView,
} from '../../../vscode/webview/messages';
import { IconButton } from './IconButton';
import {
  IconAgent,
  IconAsk,
  IconChevronDown,
  IconCopy,
  IconImage,
  IconMarkdown,
  IconPlan,
  IconRetry,
  IconSend,
  IconStop,
} from './Icons';
import { TokenMeter } from './TokenMeter';
import { APPROVAL_MODE_OPTIONS } from '../utils/approvalMode';

interface ChatInputProps {
  loading: boolean;
  mode: ThunderMode;
  approvalMode: ApprovalMode;
  activeDepth: AgentDepthView;
  tokenUsage: TokenUsageView;
  modelLabel?: string;
  pinnedContext: PinnedContextView[];
  canRetry: boolean;
  onSend: (content: string, pinnedContext: PinnedContextView[], attachments: ChatImageAttachment[]) => void;
  onStop?: () => void;
  onModeChange: (mode: ThunderMode) => void;
  onApprovalModeChange: (approvalMode: ApprovalMode) => void;
  onDepthChange: (depth: AgentDepthView) => void;
  onRetry?: () => void;
  onCopyResponse?: () => void;
  onCopyChatHistory?: () => void;
  canCopyChatHistory?: boolean;
  onAddPinned: (path: string, kind: 'file' | 'folder') => void;
  onSearchPaths: (query: string, requestId: string) => void;
  pathSuggestions: ContextPathSuggestion[];
  pathSearchRequestId: string | null;
}

type ComposerSelectId = 'mode' | 'approval' | 'depth';
type ComposerOption<T extends string> = {
  id: T;
  label: string;
  description: string;
  color: string;
  icon?: typeof IconAsk;
};

const MODES: Array<ComposerOption<Exclude<ThunderMode, 'review'>>> = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Explore and answer questions (read-only)',
    color: '#22c55e',
    icon: IconAsk,
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and propose steps',
    color: '#f59e0b',
    icon: IconPlan,
  },
  {
    id: 'agent',
    label: 'Agent',
    description: 'Apply code changes',
    color: '#ef4444',
    icon: IconAgent,
  },
];

const APPROVAL_OPTIONS: Array<ComposerOption<ApprovalMode>> = APPROVAL_MODE_OPTIONS.map((option) => {
  const colorByMode: Record<ApprovalMode, string> = {
    review_all: '#ef4444',
    ask_edits: '#f59e0b',
    ask_deletes: '#f97316',
    ask_commands: '#fb923c',
    auto: '#22c55e',
  };
  return {
    id: option.id,
    label: option.label,
    description: option.title,
    color: colorByMode[option.id],
  };
});

const DEPTH_OPTIONS: Array<ComposerOption<AgentDepthView>> = [
  { id: 'auto', label: 'Auto', description: 'Choose depth from the request', color: '#38bdf8' },
  { id: 'quick', label: 'Quick', description: 'Use a smaller exploration or execution budget', color: '#22c55e' },
  { id: 'standard', label: 'Standard', description: 'Use the normal exploration or execution budget', color: '#60a5fa' },
  { id: 'deep', label: 'Deep', description: 'Use a larger budget for complex work', color: '#f59e0b' },
  { id: 'pilot', label: 'Pilot', description: 'Use an expanded budget for broad implementation or investigation', color: '#a78bfa' },
  { id: 'enterprise', label: 'Enterprise', description: 'Use the largest built-in budget for exhaustive work', color: '#ef4444' },
];

export function ChatInput({
  loading,
  mode,
  approvalMode,
  activeDepth,
  tokenUsage,
  modelLabel,
  pinnedContext,
  canRetry,
  onSend,
  onStop,
  onModeChange,
  onApprovalModeChange,
  onDepthChange,
  onRetry,
  onCopyResponse,
  onCopyChatHistory,
  canCopyChatHistory = false,
  onAddPinned,
  onSearchPaths,
  pathSuggestions,
  pathSearchRequestId,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [searchRequestId, setSearchRequestId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [openSelect, setOpenSelect] = useState<ComposerSelectId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const visibleMode = mode === 'review' ? 'plan' : mode;
  const activeMode = MODES.find((m) => m.id === visibleMode) ?? MODES[1];
  const activeApproval = APPROVAL_OPTIONS.find((option) => option.id === approvalMode) ?? APPROVAL_OPTIONS[0];
  const selectedDepth = DEPTH_OPTIONS.find((option) => option.id === activeDepth) ?? DEPTH_OPTIONS[0];

  useEffect(() => {
    if (!searchRequestId || searchRequestId !== pathSearchRequestId) return;
    setMentionIndex(0);
  }, [pathSuggestions, pathSearchRequestId, searchRequestId]);

  const closeMention = useCallback(() => {
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(null);
    setSearchRequestId(null);
  }, []);

  const applyMention = useCallback(
    (suggestion: ContextPathSuggestion) => {
      if (mentionStart === null) return;
      const before = value.slice(0, mentionStart);
      const after = value.slice(textareaRef.current?.selectionStart ?? mentionStart + mentionQuery.length + 1);
      const tag = `@${suggestion.path}`;
      const next = `${before}${tag} ${after}`;
      setValue(next);
      onAddPinned(suggestion.path, suggestion.kind);
      closeMention();
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [closeMention, mentionQuery.length, mentionStart, onAddPinned, value]
  );

  const updateMentionState = useCallback(
    (nextValue: string, cursor: number) => {
      const beforeCursor = nextValue.slice(0, cursor);
      const atMatch = beforeCursor.match(/@([\w./_-]*)$/);
      if (!atMatch) {
        closeMention();
        return;
      }
      const query = atMatch[1] ?? '';
      const start = cursor - query.length - 1;
      setMentionOpen(true);
      setMentionQuery(query);
      setMentionStart(start);
      if (query.length >= 1) {
        const requestId = `mention-${Date.now()}`;
        setSearchRequestId(requestId);
        onSearchPaths(query, requestId);
      }
    },
    [closeMention, onSearchPaths]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || loading) return;
    onSend(trimmed || 'Please review the attached image.', pinnedContext, attachments);
    setValue('');
    setAttachments([]);
    closeMention();
  }, [value, attachments, loading, onSend, pinnedContext, closeMention]);

  const addImageFiles = useCallback((files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/')).slice(0, 6);
    for (const file of images) {
      if (file.size > 5 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const data = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
        setAttachments((current) => [
          ...current,
          {
            kind: 'image',
            mimeType: file.type || 'image/png',
            data,
            name: file.name,
            size: file.size,
          },
        ].slice(0, 6));
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && pathSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % pathSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + pathSuggestions.length) % pathSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = pathSuggestions[mentionIndex];
        if (picked) applyMention(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        closeMention();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderDropdown = <T extends string,>({
    id,
    label,
    value,
    selected,
    options,
    onChange,
  }: {
    id: ComposerSelectId;
    label: string;
    value: T;
    selected: ComposerOption<T>;
    options: Array<ComposerOption<T>>;
    onChange: (value: T) => void;
  }) => {
    const SelectedIcon = selected.icon;
    const isOpen = openSelect === id;
    return (
      <div
        className={`composer__dropdown composer__dropdown--${id}`}
        style={{ '--composer-control-color': selected.color } as CSSProperties}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setOpenSelect((current) => (current === id ? null : current));
          }
        }}
      >
        <button
          type="button"
          className="composer__dropdown-button has-tooltip"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label={label}
          data-tooltip={`${label}: ${selected.description}`}
          onClick={() => setOpenSelect((current) => (current === id ? null : id))}
        >
          <span className="composer__dropdown-value">
            {SelectedIcon ? (
              <SelectedIcon className="composer__dropdown-icon" width={14} height={14} aria-hidden />
            ) : (
              <span className="composer__dropdown-dot" aria-hidden />
            )}
            <span>{selected.label}</span>
          </span>
          <IconChevronDown className="composer__mode-chevron" width={12} height={12} aria-hidden />
        </button>
        {isOpen && (
          <div className="composer__dropdown-menu" role="listbox" aria-label={label}>
            {options.map((option) => {
              const OptionIcon = option.icon;
              const selectedOption = option.id === value;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`composer__dropdown-option has-tooltip${selectedOption ? ' composer__dropdown-option--selected' : ''}`}
                  style={{ '--composer-option-color': option.color } as CSSProperties}
                  role="option"
                  aria-selected={selectedOption}
                  data-tooltip={`${label}: ${option.description}`}
                  onClick={() => {
                    onChange(option.id);
                    setOpenSelect(null);
                  }}
                >
                  {OptionIcon ? (
                    <OptionIcon className="composer__dropdown-option-icon" width={14} height={14} aria-hidden />
                  ) : (
                    <span className="composer__dropdown-option-dot" aria-hidden />
                  )}
                  <span className="composer__dropdown-option-text">
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="composer"
      onDragOver={(e) => {
        if (!loading) e.preventDefault();
      }}
      onDrop={(e) => {
        if (loading) return;
        e.preventDefault();
        addImageFiles(e.dataTransfer.files);
      }}
    >
      <div className="composer__box">
        {mentionOpen && (
          <div className="mention-picker" role="listbox" aria-label="Context path suggestions">
            {pathSuggestions.length === 0 ? (
              <div className="mention-picker__empty">
                {mentionQuery.length < 1 ? 'Type to search files and folders…' : 'No matches'}
              </div>
            ) : (
              pathSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.kind}:${suggestion.path}`}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  className={`mention-picker__item${index === mentionIndex ? ' mention-picker__item--active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(suggestion);
                  }}
                >
                  <span className="mention-picker__icon">{suggestion.kind === 'folder' ? '📁' : '📄'}</span>
                  <span className="mention-picker__label">{suggestion.label}</span>
                </button>
              ))
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="composer__input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onClick={(e) =>
            updateMentionState(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? e.currentTarget.value.length
            )
          }
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'));
            if (files.length > 0) {
              addImageFiles(files);
            }
          }}
          placeholder="Ask anything… use @ to add files or folders"
          disabled={loading}
          rows={3}
          aria-label="Chat message input"
        />
        {attachments.length > 0 && (
          <div className="composer__attachments" aria-label="Attached images">
            {attachments.map((attachment, index) => (
              <button
                key={`${attachment.name ?? 'image'}-${index}`}
                type="button"
                className="composer__attachment"
                onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                title="Remove image"
              >
                <span className="composer__attachment-name">{attachment.name ?? `image-${index + 1}`}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer__footer">
          <div className="composer__left">
            {renderDropdown({
              id: 'mode',
              label: 'Mode',
              value: visibleMode,
              selected: activeMode,
              options: MODES,
              onChange: (nextMode) => onModeChange(nextMode),
            })}
            {renderDropdown({
              id: 'approval',
              label: 'Approval',
              value: approvalMode,
              selected: activeApproval,
              options: APPROVAL_OPTIONS,
              onChange: (nextApprovalMode) => onApprovalModeChange(nextApprovalMode),
            })}
            {renderDropdown({
              id: 'depth',
              label: 'Depth',
              value: activeDepth,
              selected: selectedDepth,
              options: DEPTH_OPTIONS,
              onChange: (nextDepth) => onDepthChange(nextDepth),
            })}
            <TokenMeter usage={tokenUsage} compact placement="above" />
            {modelLabel && (
              <span className="model-chip" title={modelLabel}>
                {modelLabel}
              </span>
            )}
          </div>
          <div className="composer__actions">
            <input
              ref={fileInputRef}
              className="composer__file-input"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                if (e.target.files) addImageFiles(e.target.files);
                e.currentTarget.value = '';
              }}
            />
            <IconButton
              label="Attach image"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
            >
              <IconImage />
            </IconButton>
            {onRetry && (
              <IconButton label="Retry last message" variant="ghost" onClick={onRetry} disabled={loading || !canRetry}>
                <IconRetry />
              </IconButton>
            )}
            {onCopyResponse && (
              <IconButton label="Copy last response" variant="ghost" onClick={onCopyResponse} disabled={loading}>
                <IconCopy />
              </IconButton>
            )}
            {onCopyChatHistory && (
              <IconButton
                label="Copy chat as Markdown"
                variant="ghost"
                onClick={onCopyChatHistory}
                disabled={!canCopyChatHistory}
              >
                <IconMarkdown />
              </IconButton>
            )}
            {loading ? (
              <IconButton label="Stop generation" variant="accent" onClick={onStop}>
                <IconStop />
              </IconButton>
            ) : (
              <IconButton
                label="Send message"
                variant="accent"
                onClick={handleSend}
                disabled={!value.trim() && attachments.length === 0}
              >
                <IconSend />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
