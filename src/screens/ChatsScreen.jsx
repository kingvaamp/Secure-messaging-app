import { useState, useRef, useEffect } from 'react';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import {
  ChevronLeft, Phone, MoreVertical, Lock, Unlock,
  Send, Plus, Mic, CheckCheck, AlertTriangle, X, FileText, Search, ShieldCheck,
  Edit3, RefreshCcw, Trash2
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useWebRTC } from '@/context/WebRTCContext';
import Av from '@/components/Av';
import BadgeE2E from '@/components/BadgeE2E';
import RedProgressBar from '@/components/RedProgressBar';
import MediaTray from '@/components/MediaTray';
import VoiceRecorder from '@/components/VoiceRecorder';
import PlasmaBackground from '@/components/PlasmaBackground';
import { encryptMessage, decryptPayload } from '@/crypto/sessionManager';

function ConversationRow({ conv, onClick, onDelete, isLast, contacts, groups }) {
  const hasUnread = conv.unreadCount > 0;
  
  let name = 'Inconnu';
  let isOnline = false;
  let isGroup = !!conv.isGroup;

  if (isGroup) {
    const group = groups.find(g => g.id === conv.contactId);
    name = group?.name || 'Groupe';
  } else {
    const contact = contacts.find((c) => c.id === conv.contactId);
    if (!contact) return null;
    name = contact.name;
    isOnline = contact.online;
  }

  const handleDelete = (e) => {
    e.stopPropagation();
    if (window.confirm(`Supprimer la conversation avec ${name} ?`)) {
      onDelete(conv.id);
    }
  };

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-all duration-500 hover:bg-white/[0.03] active:scale-[0.98] relative outline-none ${hasUnread ? 'bg-[#ff003c]/[0.02]' : ''}`}
        style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255, 0, 60, 0.08)' }}
      >
        {hasUnread && (
          <div className="absolute left-0 top-4 bottom-4 w-1 rounded-r-full" style={{ backgroundColor: '#ff003c', boxShadow: '2px 0 12px #ff003c' }} />
        )}

        <div className="relative">
          {isGroup ? (
            <div className="w-[50px] h-[50px] rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-[#ff003c]">
              <Plus size={24} />
            </div>
          ) : (
            <Av name={name} size={50} online={isOnline} borderColor={hasUnread ? '#ff003c' : 'rgba(255,255,255,0.1)'} />
          )}
          {hasUnread && (
            <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#ff003c] border-2 border-black animate-pulse" />
          )}
        </div>

        <div className="flex-1 min-w-0 ml-1">
          <div className="flex items-center justify-between mb-0.5">
            <h3 className={`text-[17px] truncate ${hasUnread ? 'font-bold text-white' : 'font-medium text-white/90'}`}>
              {name}
            </h3>
            <span className="text-[11px] font-bold tracking-tighter uppercase opacity-30">
              {conv.timestamp}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <p className={`text-[13.5px] truncate ${hasUnread ? 'text-[#ff003c] font-medium' : 'text-white/40'}`}>
              {hasUnread ? '🔒 Nouveau message sécurisé' : conv.lastMessage}
            </p>
          </div>
        </div>
      </button>
      
      {/* Tactical Delete Button */}
      <button
        onClick={handleDelete}
        className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full bg-[#ff003c]/10 text-[#ff003c] opacity-0 group-hover:opacity-100 transition-all hover:bg-[#ff003c] hover:text-white active:scale-90 shadow-[0_0_15px_rgba(255,0,60,0.2)]"
      >
        <Trash2 size={18} />
      </button>
    </div>
  );
}

// ============================================
// Message Bubble (Premium Glow & Glass)
// ============================================
function MessageBubble({ message, isSent, onDecrypt, ttl, isVanishing }) {
  const [glitching, setGlitching] = useState(false);

  const handleTap = () => {
    if (message.locked) {
      setGlitching(true);
      setTimeout(() => {
        setGlitching(false);
        onDecrypt();
      }, 200);
    }
  };

  return (
    <div 
      className={`flex ${isSent ? 'justify-end pl-12' : 'justify-start pr-12'} transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] px-4`}
      style={{
        opacity: isVanishing ? 0 : 1,
        transform: isVanishing ? 'scale(0.9) translateY(20px)' : 'scale(1) translateY(0)',
        filter: isVanishing ? 'blur(12px)' : 'none',
        maxHeight: isVanishing ? 0 : 800,
        marginBottom: isVanishing ? 0 : 12,
      }}
    >
      <div
        className="relative group cursor-pointer active:scale-[0.98] transition-transform"
        onClick={handleTap}
      >
        <div
          className={`px-4 py-2.5 rounded-[22px] transition-all duration-300 relative overflow-hidden ${
            isSent 
              ? 'bg-gradient-to-br from-[#ff003c] to-[#8b0000] text-white shadow-[0_4px_20px_rgba(255,0,60,0.25)]' 
              : 'bg-white/[0.03] border border-white/10 text-white/90 backdrop-blur-md'
          }`}
          style={{
            borderRadius: isSent ? '22px 22px 4px 22px' : '22px 22px 22px 4px',
            filter: glitching ? 'hue-rotate(90deg) brightness(1.5) contrast(1.2)' : 'none',
          }}
        >
          {/* Subtle noise/texture overlay */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />

          {message.locked ? (
            <div className="flex items-center gap-2 py-1">
              <Lock size={14} className={isSent ? 'text-white/60' : 'text-[#ff003c]'} />
              <span className={`text-[13px] font-medium tracking-tight ${isSent ? 'text-white/80' : 'text-[#ff003c]'}`}>
                {isSent ? 'Toucher pour révéler' : 'Message chiffré'}
              </span>
            </div>
          ) : (
            <>
              {message.attachment && (
                <div className="mb-2.5 rounded-xl overflow-hidden border border-white/10 shadow-inner">
                  {message.attachment.type.startsWith('image/') ? (
                    <img src={message.attachment.url} alt="attachment" className="w-full max-h-[260px] object-cover" />
                  ) : message.attachment.type.startsWith('video/') ? (
                    <video src={message.attachment.url} controls className="w-full max-h-[260px] bg-black" />
                  ) : (
                    <div className="flex items-center gap-3 p-4 bg-white/5">
                      <FileText size={20} className="text-[#ff003c]" />
                      <span className="text-[13px] font-medium truncate">{message.attachment.name}</span>
                    </div>
                  )}
                </div>
              )}
              {message.text && (
                <p className="text-[15px] leading-relaxed tracking-tight">{message.text}</p>
              )}
              <div className="flex items-center justify-end gap-1.5 mt-1.5 opacity-50">
                <span className="text-[10px] font-bold">{message.time}</span>
                {isSent && <CheckCheck size={12} className={message.isRead ? 'text-white' : 'text-white/40'} />}
              </div>
              
              {/* TTL Progress Line */}
              {message.isRead && message.ttl > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  <RedProgressBar ttl={ttl} max={message.ttl || 180} />
                  <div className="flex justify-between items-center text-[9px] font-black tracking-widest uppercase opacity-40">
                    <span>Vanish</span>
                    <span>{Math.floor(ttl / 60)}:{(ttl % 60).toString().padStart(2, '0')}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        
        {/* Glow effect for sent messages */}
        {isSent && !isVanishing && (
          <div className="absolute -inset-1 bg-[#ff003c]/20 blur-xl rounded-full -z-10 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
    </div>
  );
}

// ============================================
// ============================================
// New Message Modal (Premium Redesign)
// ============================================
function NewMessageModal({ onClose, onConfirm }) {
  const { contacts } = useApp();
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('private'); // 'private', 'group', 'broadcast'
  const [groupName, setGroupName] = useState('');

  const filtered = contacts.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.phone.includes(search)
  );

  const toggleContact = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleStart = () => {
    if (mode === 'private' && selected.length === 1) {
      onConfirm('private', { contactId: selected[0] });
    } else if (mode === 'group' && selected.length >= 1 && groupName.trim()) {
      onConfirm('group', { name: groupName.trim(), memberIds: selected });
    } else if (mode === 'broadcast' && selected.length >= 1) {
      onConfirm('broadcast', { memberIds: selected });
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col animate-in fade-in zoom-in-95 duration-200">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />
      
      {/* Header */}
      <div 
        className="relative flex items-center justify-between px-4 py-3 z-10" 
        style={{ borderBottom: '1px solid rgba(255,0,60,0.15)', backgroundColor: 'rgba(10, 0, 5, 0.6)' }}
      >
        <button onClick={onClose} className="p-2 -ml-2 text-white/60 hover:text-white transition-colors active:scale-90">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-[17px] font-semibold tracking-tight text-white">
          {mode === 'group' ? 'Nouveau Groupe' : mode === 'broadcast' ? 'Nouvelle Diffusion' : 'Nouveau message'}
        </h2>
        {selected.length > 0 ? (
          <button 
            onClick={handleStart} 
            className="px-4 py-1.5 rounded-full text-[13px] font-bold text-white transition-all shadow-[0_0_15px_rgba(255,0,60,0.5)] active:scale-95" 
            style={{ backgroundColor: '#ff003c' }}
          >
            {mode === 'group' ? 'Créer' : 'Démarrer'}
          </button>
        ) : (
          <div className="w-10" />
        )}
      </div>

      {/* Mode Switcher */}
      <div className="relative px-4 pt-4 z-10">
        <div className="flex p-1 rounded-xl bg-white/5 border border-white/10 backdrop-blur-md">
          {[
            { id: 'private', label: 'Chat', icon: Send },
            { id: 'group', label: 'Groupe', icon: Plus },
            { id: 'broadcast', label: 'Diffusion', icon: RefreshCcw }
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                if (m.id === 'private' && selected.length > 1) setSelected([selected[0]]);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-[12px] font-bold transition-all duration-300 ${mode === m.id ? 'bg-[#ff003c] text-white shadow-[0_0_12px_rgba(255,0,60,0.4)]' : 'text-white/40 hover:text-white/60'}`}
            >
              <m.icon size={14} />
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Group Name Input */}
      {mode === 'group' && (
        <div className="relative px-4 pt-4 z-10 animate-in slide-in-from-top-2 duration-300">
          <div 
            className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all"
            style={{ 
              backgroundColor: 'rgba(255,255,255,0.04)', 
              border: '1px solid rgba(255,0,60,0.2)',
              boxShadow: 'inset 0 0 10px rgba(255,0,60,0.05)'
            }}
          >
            <Edit3 size={18} className="text-[#ff003c]" />
            <input 
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Nom du groupe..."
              className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/20 outline-none"
            />
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="relative px-4 py-4 z-10">
        <div 
          className="flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all"
          style={{ 
            backgroundColor: 'rgba(255,255,255,0.04)', 
            border: '1px solid rgba(255,0,60,0.1)',
          }}
        >
          <Search size={18} className="text-white/30" />
          <input 
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un contact..."
            className="flex-1 bg-transparent text-[15px] text-white placeholder:text-white/20 outline-none"
          />
        </div>
      </div>

      {/* Contact list */}
      <div className="relative flex-1 overflow-y-auto px-4 pb-10 z-10" style={{ scrollbarWidth: 'none' }}>
        <div 
          className="rounded-[24px] overflow-hidden" 
          style={{ 
            backgroundColor: 'rgba(255, 255, 255, 0.02)', 
            border: '1px solid rgba(255, 0, 60, 0.08)',
            backdropFilter: 'blur(20px)'
          }}
        >
          {filtered.map((contact, index) => (
            <button
              key={contact.id}
              onClick={() => {
                if (mode === 'private') setSelected([contact.id]);
                else toggleContact(contact.id);
              }}
              className="w-full flex items-center gap-4 px-5 py-4 text-left transition-all hover:bg-white/[0.04] active:bg-white/[0.08] group"
              style={{ borderBottom: index < filtered.length - 1 ? '1px solid rgba(255,0,60,0.05)' : 'none' }}
            >
              <div
                className="flex items-center justify-center rounded-lg border transition-all flex-shrink-0"
                style={{
                  width: 22,
                  height: 22,
                  borderColor: selected.includes(contact.id) ? '#ff003c' : 'rgba(255,255,255,0.15)',
                  backgroundColor: selected.includes(contact.id) ? '#ff003c' : 'transparent',
                  boxShadow: selected.includes(contact.id) ? '0 0 10px rgba(255,0,60,0.4)' : 'none'
                }}
              >
                {selected.includes(contact.id) && <CheckCheck size={14} className="text-white" />}
              </div>
              <Av name={contact.name} size={42} online={contact.online} />
              <div className="flex-1 min-w-0">
                <p className="text-[16px] text-white/90 font-medium">{contact.name}</p>
                <p className="text-[12px] opacity-40">{contact.phone}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Security footer */}
      <div className="relative p-6 text-center z-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
          <Lock size={10} style={{ color: '#ff003c' }} />
          <span className="text-[9px] uppercase tracking-wider text-white/40 font-bold">Chiffrement Signal Automatique</span>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Chat Detail View
// ============================================
// ============================================
// Chat Detail View (Premium Redesign)
// ============================================
function ChatDetail({ conv, onBack }) {
  const { contacts, currentUser, deleteMessage, sendMessage, sendGroupMessage, decryptMessage, addNotification, groups, acquireSendLock, releaseSendLock } = useApp();
  const { initiateCall } = useWebRTC();
  const contact = contacts.find((c) => c.id === conv.contactId);
  const [messageText, setMessageText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const fileInputRef = useRef(null);
  const [showMedia, setShowMedia] = useState(false);
  const [recording, setRecording] = useState(false);
  const [messageTtls, setMessageTtls] = useState({});
  const vanishingIdsRef = useRef(new Set());
  const [, setForceRender] = useState(0);
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv.messages]);

  // TTL countdown engine
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageTtls((prev) => {
        const next = { ...prev };
        let changed = false;
        let vanishingChanged = false;

        conv.messages.forEach((m) => {
          if (m.isRead && !m.locked) {
            let currentTtl = prev[m.id] !== undefined ? prev[m.id] : m.ttl;

            if (m.expiresAt) {
              const current = Math.max(0, Math.ceil((m.expiresAt - Date.now()) / 1000));
              if (currentTtl !== current) {
                next[m.id] = current;
                currentTtl = current;
                changed = true;
              }
            } else if (currentTtl > 0) {
              next[m.id] = currentTtl - 1;
              currentTtl -= 1;
              changed = true;
            }

            if (currentTtl <= 0 && !vanishingIdsRef.current.has(m.id)) {
              vanishingIdsRef.current.add(m.id);
              vanishingChanged = true;
              setTimeout(() => {
                deleteMessage(conv.id, m.id);
              }, 600);
            }
          }
        });

        if (vanishingChanged) {
          setForceRender(v => v + 1);
        }

        return changed ? next : prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [conv.messages, conv.id, deleteMessage]);

  const handleMediaSelect = (type) => {
    setShowMedia(false);
    if (fileInputRef.current) {
      if (type === 'photo') fileInputRef.current.accept = 'image/*';
      else if (type === 'video') fileInputRef.current.accept = 'video/*';
      else fileInputRef.current.accept = '*/*';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      addNotification({ type: 'error', text: '⚠️ Fichier trop lourd (max 5 Mo)' });
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachment({
        url: event.target.result,
        type: file.type,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  if (!conv.isGroup && !contact) return null;

  const handleSend = async () => {
    if (!messageText.trim() && !attachment) return;

    // Module-level lock — prevents double-send even if the component remounts
    const lockKey = `chat::${conv.id}`;
    if (!acquireSendLock(lockKey)) return;

    try {
      let plaintext = messageText.trim();
      if (attachment) {
        plaintext = JSON.stringify({ text: plaintext, attachment });
      }

      if (conv.isGroup) {
        // ── Group path ──────────────────────────────────────────────
        // Fully delegated to AppContext.sendGroupMessage — this is the ONLY
        // place that calls encryptMessage for group sends. Doing it here AND
        // in context would double-advance the ratchet and break decryption.
        await sendGroupMessage(conv.id, plaintext, {
          text: messageText.trim(),
          attachment,
        });
      } else {
        // ── 1:1 path ──────────────────────────────────────────────
        let payload = null;
        try {
          payload = await encryptMessage(conv.id, conv.contactId, plaintext);
        } catch (e) {
          console.error('[Chat] Encryption error:', e);
          addNotification({ type: 'error', text: '⚠️ Échec du chiffrement: ' + (e?.message || 'Erreur inconnue') });
          return;
        }

        const newMsg = {
          id: `msg-${Date.now()}-${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')}`,
          senderId: 'me',
          text: messageText.trim(),
          attachment,
          time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          isRead: false,
          ttl: 0,
          locked: true,
          payload,
        };
        sendMessage(conv.id, newMsg);
      }

      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      setMessageText('');
      setAttachment(null);
    } finally {
      releaseSendLock(lockKey);
    }
  };

  const handleDecrypt = async (msg) => {
    if (msg.locked === false) return;

    let plaintext = '';
    let attachmentObj = null;

    if (msg.senderId === 'me') {
      // We are the sender — plaintext is already stored locally, no decryption needed.
      plaintext = msg.text;
      attachmentObj = msg.attachment;
    } else if (msg.payload?.iv && msg.payload?.ciphertext) {
      try {
        // For GROUP messages: the session key is a pairwise `${convId}::${senderId}`
        // so Alice→Bob and Alice→Charlie never share the same ratchet chain.
        // The sender embeds `groupSessionKey` in the message; we fall back to
        // constructing it ourselves from `conv.id::msg.senderId` if not present.
        let sessionId;
        let contactId;
        if (conv.isGroup) {
          // Use the embedded session key if present; otherwise reconstruct it.
          sessionId = msg.groupSessionKey || `${conv.id}::${msg.senderId}`;
          contactId = msg.senderId; // the individual sender, not the group
        } else {
          // Standard 1:1 conversation
          sessionId = conv.id;
          contactId = conv.contactId;
        }

        const decryptedStr = await decryptPayload(sessionId, contactId, msg.payload);
        try {
          const parsed = JSON.parse(decryptedStr);
          if (parsed.text !== undefined || parsed.attachment !== undefined) {
             plaintext = parsed.text;
             attachmentObj = parsed.attachment;
          } else {
             plaintext = decryptedStr;
          }
        } catch {
          plaintext = decryptedStr;
        }
      } catch {
        addNotification({ type: 'error', text: '⚠️ Authentification échouée' });
        return;
      }
    } else {
      plaintext = 'Message déchiffré avec succès.';
    }

    decryptMessage(conv.id, msg.id, { text: plaintext, attachment: attachmentObj });
    setMessageTtls((prev) => ({ ...prev, [msg.id]: 180 }));
  };

  return (
    <div className="absolute inset-0 z-[50] flex flex-col overflow-hidden">
      <PlasmaBackground opacity={0.6} />

      {/* Header - Holographic Glass */}
      <div
        className="relative flex items-center gap-4 px-4 pt-12 pb-5 flex-shrink-0 z-20"
        style={{
          background: 'linear-gradient(to bottom, rgba(20, 0, 5, 0.8), rgba(5, 0, 0, 0.4))',
          backdropFilter: 'blur(30px) saturate(150%)',
          borderBottom: '1px solid rgba(255, 0, 60, 0.2)',
          boxShadow: '0 4px 30px rgba(0, 0, 0, 0.5)',
        }}
      >
        <button onClick={onBack} className="text-white/40 hover:text-[#ff003c] transition-all p-2 -ml-3 active:scale-75">
          <ChevronLeft size={28} strokeWidth={2.5} />
        </button>

        <div className="relative group">
          {conv.isGroup ? (
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 border border-white/10 text-[#ff003c]">
               <Plus size={20} />
            </div>
          ) : (
            <Av name={contact?.name || 'Inconnu'} size={40} online={contact?.online} />
          )}
          <div className="absolute -inset-1 bg-[#ff003c]/20 blur-md rounded-full -z-10 group-hover:opacity-100 opacity-0 transition-opacity" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-[17px] font-black text-white truncate tracking-tight drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
            {conv.isGroup ? (groups.find(g => g.id === conv.contactId)?.name || 'Groupe') : (contact?.name || 'Inconnu')}
          </h3>
          <div className="flex items-center gap-2 -mt-0.5">
            {conv.isGroup ? (
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#ff003c]/90">
                {groups.find(g => g.id === conv.contactId)?.members.length || 0} Membres
              </span>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-[pulse_1.5s_infinite] shadow-[0_0_10px_#22c55e]" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#22c55e]/90">Protégé · En Ligne</span>
              </>
            )}
            <div className="h-2.5 w-[1px] bg-white/10 mx-1" />
            <BadgeE2E />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!conv.isGroup && (
            <button 
              onClick={() => initiateCall(contact.id)}
              className="w-10 h-10 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
            >
              <Phone size={20} />
            </button>
          )}
          <button className="w-10 h-10 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90">
            <MoreVertical size={20} />
          </button>
        </div>
      </div>

      {/* Messages - Floating List */}
      <div className="relative flex-1 overflow-y-auto pt-8 pb-4 space-y-4 z-10 custom-scrollbar">
        {conv.messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20">
            <div className="w-16 h-16 rounded-full border border-dashed border-[#ff003c] flex items-center justify-center mb-4">
              <Lock size={24} className="text-[#ff003c]" />
            </div>
            <p className="text-[11px] font-black uppercase tracking-[0.4em] text-[#ff003c]">Canal Sécurisé</p>
          </div>
        ) : (
          conv.messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isSent={msg.senderId === 'me'}
              onDecrypt={() => handleDecrypt(msg)}
              ttl={messageTtls[msg.id] !== undefined ? messageTtls[msg.id] : msg.ttl}
              isVanishing={vanishingIdsRef.current.has(msg.id)}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area - The "Blade" */}
      <div className="relative flex-shrink-0 pb-12 pt-4 px-4 z-20">
        <div className="relative w-full mx-auto">
          {attachment && (
            <div className="absolute bottom-full left-0 right-0 mb-6 animate-in zoom-in-95 fade-in duration-300">
              <div className="mx-auto p-2 rounded-2xl bg-black/80 backdrop-blur-3xl border border-[#ff003c]/40 flex items-center gap-4 w-fit max-w-full shadow-[0_20px_50px_rgba(0,0,0,0.9)]">
                {attachment.type.startsWith('image/') ? (
                  <img src={attachment.url} alt="preview" className="w-16 h-16 object-cover rounded-xl border border-white/10" />
                ) : (
                  <div className="w-16 h-16 flex items-center justify-center bg-[#ff003c]/20 rounded-xl text-[#ff003c]">
                    <FileText size={28} />
                  </div>
                )}
                <div className="pr-6">
                  <p className="text-[13px] font-bold text-white tracking-tight truncate max-w-[200px]">{attachment.name}</p>
                  <p className="text-[10px] text-[#ff003c] font-black uppercase tracking-widest mt-0.5">Fichier Prêt</p>
                </div>
                <button 
                  onClick={() => setAttachment(null)} 
                  className="w-8 h-8 bg-[#ff003c] text-white rounded-full flex items-center justify-center hover:scale-110 active:scale-90 transition-all shadow-[0_0_15px_rgba(255,0,60,0.5)]"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          <MediaTray open={showMedia} onSelect={handleMediaSelect} />
          <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />

          {recording ? (
            <VoiceRecorder
              onCancel={() => setRecording(false)}
              onSend={() => setRecording(false)}
            />
          ) : (
            <div
              className="flex items-center gap-3 p-2.5 rounded-[32px] transition-all duration-500"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 0, 60, 0.25)',
                backdropFilter: 'blur(40px)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.8), inset 0 1px 1px rgba(255,255,255,0.05)',
              }}
            >
              <button
                onClick={() => setShowMedia(!showMedia)}
                className={`w-12 h-12 flex items-center justify-center rounded-full transition-all active:scale-90 ${showMedia ? 'bg-[#ff003c] text-white shadow-[0_0_20px_rgba(255,0,60,0.6)]' : 'bg-white/5 text-white/40 hover:text-white'}`}
              >
                <Plus size={24} className={showMedia ? 'rotate-45 transition-transform' : 'transition-transform'} />
              </button>

              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Écrire un message chiffré..."
                rows={1}
                className="flex-1 bg-transparent text-[16px] text-white placeholder:text-white/20 outline-none resize-none py-3 px-2 font-medium"
                style={{ minHeight: 48, maxHeight: 180 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />

              <div className="flex items-center gap-2 mr-1">
                {!messageText.trim() && !attachment ? (
                  <button
                    onClick={() => setRecording(true)}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-white/5 text-white/40 hover:text-white transition-all active:scale-90"
                  >
                    <Mic size={24} />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    className="w-12 h-12 flex items-center justify-center rounded-full bg-[#ff003c] text-white shadow-[0_8px_25px_rgba(255,0,60,0.5)] hover:scale-105 active:scale-90 transition-all"
                  >
                    <Send size={20} className="ml-1" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Crypto Integrity Footer */}
          <div className="mt-4 flex justify-between items-center px-6 opacity-30">
            <div className="flex items-center gap-2">
              <ShieldCheck size={12} className="text-[#ff003c]" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white">E2E Enforced</span>
            </div>
            <span className="text-[9px] font-mono text-white/50">DR-SESSION: {conv.id.slice(-8).toUpperCase()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Broadcast Detail View (Special One-off UI)
// ============================================
function BroadcastDetail({ memberIds, onBack }) {
  const { contacts, sendBroadcast, addNotification, acquireSendLock, releaseSendLock } = useApp();
  const [messageText, setMessageText] = useState('');
  
  const selectedContacts = contacts.filter(c => memberIds.includes(c.id));

  const handleSend = async () => {
    if (!messageText.trim()) return;

    // Module-level lock keyed on the recipient set — prevents double-sends
    // across component remounts.
    const lockKey = `broadcast::${memberIds.sort().join(',')}`;
    if (!acquireSendLock(lockKey)) return;

    try {
      const newMsg = {
        id: `broadcast-${Date.now()}`,
        senderId: 'me',
        text: messageText.trim(),
        time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        isRead: false,
        ttl: 0,
        locked: true,
      };

      await sendBroadcast(memberIds, newMsg);
      addNotification({ type: 'success', text: `Message envoyé à ${memberIds.length} contacts.` });
      onBack();
    } catch (e) {
      addNotification({ type: 'error', text: 'Erreur lors de la diffusion.' });
    } finally {
      releaseSendLock(lockKey);
    }
  };

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      <PlasmaBackground opacity={0.6} />
      
      {/* Tactical Header */}
      <div className="relative z-10 flex items-center gap-4 px-4 pt-12 pb-6 bg-black/40 backdrop-blur-2xl border-b border-[#ff003c]/10">
        <button onClick={onBack} className="p-2 -ml-2 rounded-full hover:bg-[#ff003c]/10 text-white/60 transition-colors">
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1">
          <h2 className="text-[18px] font-black text-white tracking-tight drop-shadow-[0_0_10px_rgba(255,0,60,0.3)]">
            Canal de Diffusion
          </h2>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#ff003c] font-black">
              {memberIds.length} Destinataires
            </span>
            <div className="flex -space-x-2 ml-2">
              {selectedContacts.slice(0, 3).map(c => (
                <div key={c.id} className="w-5 h-5 rounded-full border border-black overflow-hidden bg-[#ff003c]/20 flex items-center justify-center text-[8px] font-bold text-white">
                  {c.name[0]}
                </div>
              ))}
              {memberIds.length > 3 && (
                <div className="w-5 h-5 rounded-full border border-black bg-white/5 flex items-center justify-center text-[7px] font-black text-white/40">
                  +{memberIds.length - 3}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Tactical View */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="relative mb-8">
          <div className="absolute inset-0 bg-[#ff003c]/20 blur-[40px] rounded-full animate-pulse" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#ff003c]/20 to-transparent flex items-center justify-center border border-[#ff003c]/20 shadow-[0_0_30px_rgba(255,0,60,0.2)]">
            <RefreshCcw size={40} className="text-[#ff003c]" />
          </div>
        </div>
        
        <h3 className="text-white text-xl font-black mb-3 tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]">
          Transmission Sécurisée
        </h3>
        <p className="text-white/40 text-[13px] max-w-xs leading-relaxed font-medium">
          Votre message sera chiffré individuellement pour chaque destinataire. Aucun lien entre les contacts n'est partagé.
        </p>
      </div>

      {/* Tactical Input Area */}
      <div className="relative z-10 p-6 pb-[100px] bg-gradient-to-t from-black to-transparent">
        <div className="flex items-center gap-3 bg-white/[0.03] backdrop-blur-3xl rounded-[22px] p-2 pl-5 border border-white/5 shadow-2xl">
          <input
            autoFocus
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Composer le message de diffusion..."
            className="flex-1 bg-transparent text-white text-[15px] outline-none placeholder:text-white/20 font-medium py-2"
          />
          <button
            onClick={handleSend}
            disabled={!messageText.trim()}
            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-[#ff003c] text-white disabled:opacity-20 disabled:grayscale transition-all active:scale-95 shadow-[0_0_20px_rgba(255,0,60,0.4)] hover:shadow-[0_0_30px_rgba(255,0,60,0.6)]"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Chats Screen
// ============================================
export default function ChatsScreen() {
  const { 
    conversations, 
    activeChatId, 
    setActiveChat, 
    closeChat, 
    currentUser, 
    contacts, 
    createConversation,
    createGroup,
    groups,
    deleteConversation
  } = useApp();
  const { initiateCall } = useWebRTC();
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [activeBroadcast, setActiveBroadcast] = useState(null);

  const activeConv = conversations.find((c) => c.id === activeChatId);

  if (activeBroadcast) {
    return <BroadcastDetail memberIds={activeBroadcast} onBack={() => setActiveBroadcast(null)} />;
  }

  if (activeConv) {
    return <ChatDetail conv={activeConv} onBack={closeChat} />;
  }

  if (showNewMessage) {
    return (
      <NewMessageModal
        onClose={() => setShowNewMessage(false)}
        onConfirm={async (type, data) => {
          setShowNewMessage(false);
          if (type === 'private') {
            const contactId = data.contactId;
            const existing = conversations.find((c) => c.contactId === contactId);
            if (existing) {
              setActiveChat(existing.id);
            } else {
              const newId = createConversation(contactId);
              setActiveChat(newId);
            }
          } else if (type === 'group') {
            // createGroup is async (Supabase persist) — must await to get the group ID string
            const newGroupId = await createGroup(data.name, data.memberIds);
            const newId = createConversation(newGroupId, true);
            setActiveChat(newId);
          } else if (type === 'broadcast') {
            setActiveBroadcast(data.memberIds);
          }
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 pt-12 pb-5 flex-shrink-0 z-20"
        style={{
          backgroundColor: 'rgba(8, 0, 4, 0.75)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 0, 60, 0.1)',
        }}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-[20px] font-semibold tracking-wider">
            <span style={{ color: '#ff003c', textShadow: '0 0 10px rgba(255,0,60,0.4)' }}>Vanish</span>
            <span className="text-white">Text</span>
          </h1>
          <BadgeE2E />
        </div>

        <div className="flex items-center gap-3">
          {/* Logged-in user identity chip — read-only, no debug toggle */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium"
            style={{ backgroundColor: 'rgba(255, 0, 60, 0.08)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,0,60,0.12)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#ff003c', boxShadow: '0 0 6px #ff003c' }} />
            {currentUser?.pseudo || currentUser?.name || 'Chargement...'}
          </div>

          <button
            onClick={() => setShowNewMessage(true)}
            className="flex items-center justify-center rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
            style={{ width: 36, height: 36, backgroundColor: 'rgba(255, 0, 60, 0.15)', boxShadow: '0 0 12px rgba(255,0,60,0.3)' }}
          >
            <Plus size={18} style={{ color: '#ff003c' }} />
          </button>
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-4 pb-28 pt-6" style={{ scrollbarWidth: 'none' }}>
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-20">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ backgroundColor: 'rgba(255, 0, 60, 0.08)' }}>
              <Lock size={32} style={{ color: '#ff003c' }} />
            </div>
            <p className="text-white/60 text-[15px] mb-4">Aucune conversation sécurisée.</p>
            <button
              onClick={() => setShowNewMessage(true)}
              className="px-6 py-2.5 rounded-xl text-[14px] text-white font-medium transition-transform active:scale-95 shadow-[0_0_20px_rgba(255,0,60,0.4)]"
              style={{ backgroundColor: '#ff003c' }}
            >
              Nouveau message
            </button>
          </div>
        ) : (
          <div 
            className="rounded-[20px] overflow-hidden backdrop-blur-2xl" 
            style={{ 
              backgroundColor: 'rgba(10, 0, 5, 0.55)', 
              border: '1px solid rgba(255, 0, 60, 0.1)',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
            }}
          >
            {conversations.map((conv, index) => (
              <ConversationRow
                key={conv.id}
                conv={conv}
                contacts={contacts}
                groups={groups}
                isLast={index === conversations.length - 1}
                onClick={() => setActiveChat(conv.id)}
                onDelete={deleteConversation}
              />
            ))}
          </div>
        )}

        {/* Security footer (moved inside scroll to avoid overlapping TabBar) */}
        {conversations.length > 0 && (
          <div className="mt-8 text-center">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: 'rgba(255, 0, 60, 0.05)', border: '1px solid rgba(255, 0, 60, 0.08)' }}
            >
              <Lock size={10} style={{ color: '#ff003c' }} />
              <span className="text-[9px] tracking-wide uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>
                E2E Chiffrement · 3 min TTL · Forward Secrecy
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
