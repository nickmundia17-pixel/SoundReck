import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X, Trash2, Sparkles } from 'lucide-react';

export type ChatPersona = 'producer' | 'mixing' | 'dj' | 'growth';
export type ChatModelTier = 'general' | 'fast' | 'complex' | 'deep';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  modelUsed?: string;
}

interface StudioChatBotProps {
  activeTab: string;
  bpm: number;
  activeTrackTitle: string;
  hidden?: boolean;
  hasFloatingPlayer?: boolean;
}

const PERSONA_OPTIONS: { id: ChatPersona; label: string; starter: string }[] = [
  {
    id: 'producer',
    label: 'Producer AI',
    starter: 'Suggest an Afrobeats chord progression & Lyria prompt at 112 BPM.',
  },
  {
    id: 'mixing',
    label: 'Mix Engineer',
    starter: 'How should I EQ and compress vocals over a heavy 808 sub bass?',
  },
  {
    id: 'dj',
    label: 'DJ Selector',
    starter: 'How do I smoothly transition from 112 BPM Afrobeats into 124 BPM House?',
  },
  {
    id: 'growth',
    label: 'Creator Growth',
    starter: 'Build a 3-day TikTok, IG Reels & BuymeSoda teaser rollout for my new drop.',
  },
];

const MODEL_OPTIONS: { id: ChatModelTier; label: string; modelName: string }[] = [
  { id: 'general', label: 'Gemini 4 Hydrogen (General)', modelName: 'gemini-4-hydrogen' },
  { id: 'fast', label: 'Gemini 3.1 Flash Lite (Fast)', modelName: 'gemini-3.1-flash-lite' },
  { id: 'complex', label: 'Gemini 4 Argon (Complex)', modelName: 'gemini-4-argon' },
  { id: 'deep', label: 'Gemini 4 Carbon (Deep Reasoning)', modelName: 'gemini-4-carbon' },
];

export function StudioChatBot({
  activeTab,
  bpm,
  activeTrackTitle,
  hidden = false,
  hasFloatingPlayer = false,
}: StudioChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [persona, setPersona] = useState<ChatPersona>('producer');
  const [modelTier, setModelTier] = useState<ChatModelTier>('general');
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'model',
      text: 'Welcome to SoundDeck Studio Co-Pilot. Pick a specialist role and ask anything about beats, Lyria prompts, vocal mixing, VirtualDJ transitions, or social rollout.',
      modelUsed: 'gemini-4-hydrogen',
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  if (hidden) return null;

  const activePersonaObj = PERSONA_OPTIONS.find((p) => p.id === persona) || PERSONA_OPTIONS[0];

  const handleSendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? inputText).trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
    };

    const nextThread = [...messages, userMsg];
    setMessages(nextThread);
    if (!overrideText) setInputText('');
    setSending(true);
    setErrorMsg(null);

    try {
      const apiMessages = nextThread
        .filter((m) => m.id !== 'welcome-1')
        .map((m) => ({ role: m.role, text: m.text }));

      const res = await fetch('/api/gemini/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          persona,
          modelTier,
          studioContext: {
            activeTab,
            bpm,
            activeTrackTitle,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to get response from Gemini.');
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: 'model',
          text: data.reply || 'No text response returned.',
          modelUsed: data.modelUsed,
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Chat error occurred.');
    } finally {
      setSending(false);
    }
  };

  const handleClearHistory = () => {
    setErrorMsg(null);
    setMessages([
      {
        id: 'welcome-1',
        role: 'model',
        text: `Started a fresh ${activePersonaObj.label} thread (${bpm} BPM · "${activeTrackTitle}"). How can I assist your session?`,
      },
    ]);
  };

  return (
    <div
      className={`fixed right-5 z-30 flex flex-col items-end transition-all duration-150 ${
        hasFloatingPlayer ? 'bottom-24' : 'bottom-5'
      }`}
    >
      {isOpen ? (
        <div className="w-[92vw] sm:w-[400px] h-[540px] max-h-[82vh] rounded-xl bg-[#13161B] border border-[#2A313E] shadow-2xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 bg-[#0B0D10] border-b border-[#232833] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <h3 className="font-display text-sm font-bold text-slate-100 leading-none">
                  Studio AI Co-Pilot
                </h3>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                  {activeTrackTitle} · {bpm} BPM
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleClearHistory}
                title="Clear conversation"
                aria-label="Clear conversation"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1B2028] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close Studio AI Chat"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1B2028] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Role & Model Selectors */}
          <div className="px-3 py-2.5 bg-[#0F1217] border-b border-[#232833] grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Specialist Role
              </label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as ChatPersona)}
                className="w-full px-2 py-1.5 rounded bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              >
                {PERSONA_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-mono text-slate-400 mb-1">
                Gemini Model
              </label>
              <select
                value={modelTier}
                onChange={(e) => setModelTier(e.target.value as ChatModelTier)}
                className="w-full px-2 py-1.5 rounded bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scrollable Message Thread */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#0B0D10]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[86%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-amber-500 text-slate-950 font-medium'
                      : 'bg-[#13161B] border border-[#232833] text-slate-200'
                  }`}
                >
                  {msg.text}
                </div>
                {msg.modelUsed && (
                  <span className="text-[10px] font-mono text-slate-500 mt-1 px-1">
                    {msg.modelUsed}
                  </span>
                )}
              </div>
            ))}

            {sending && (
              <div className="flex items-start">
                <div className="rounded-xl px-3.5 py-2 bg-[#13161B] border border-[#232833] text-xs text-slate-400">
                  Composing studio response...
                </div>
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="px-3 py-2 bg-red-950/60 border-t border-red-800/60 text-[11px] text-red-200">
              {errorMsg}
            </div>
          )}

          {/* Quick Starter & Input Form */}
          <div className="p-3 bg-[#13161B] border-t border-[#232833] space-y-2">
            <button
              type="button"
              onClick={() => handleSendMessage(activePersonaObj.starter)}
              disabled={sending}
              className="w-full text-left px-2.5 py-1.5 rounded bg-[#0B0D10] hover:bg-[#1B2028] border border-[#232833] text-[11px] text-slate-300 truncate transition-colors"
            >
              Try: {activePersonaObj.starter}
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Ask ${activePersonaObj.label}...`}
                className="flex-1 px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={sending || !inputText.trim()}
                aria-label="Send message"
                className="p-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs shadow-xl flex items-center gap-2 transition-colors"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Studio AI Chat</span>
        </button>
      )}
    </div>
  );
}
