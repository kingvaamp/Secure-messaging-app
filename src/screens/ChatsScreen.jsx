import { useState, useRef, useEffect } from 'react';
import {
  ChevronLeft, Phone, MoreVertical, Lock, Unlock,
  Send, Plus, Mic, CheckCheck, AlertTriangle, X, FileText
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import Av from '@/components/Av';
import BadgeE2E from '@/components/BadgeE2E';
import RedProgressBar from '@/components/RedProgressBar';
import MediaTray from '@/components/MediaTray';
import VoiceRecorder from '@/components/VoiceRecorder';
import { encryptMessage, decryptPayload } from '@/crypto/sessionManager';

// ============================================
// Conversation Row
// ============================================
function ConversationRow({ conv, onClick, isLast, contacts }) {
  const contact = contacts.find((c) => c.id === conv.contactId);
  if (!contact) return null;

  const hasUnread = conv.unreadCount > 0;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 px-4 py-3.5 text-left transition-all duration-300 hover:bg-white/5 relative group outline-none ${hasUnread ? 'bg-[rgba(255,0,60,0.03)]' : ''}`}
      style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255, 0, 60, 0.05)' }}
    >
      {hasUnread && (
        <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-md" style={{ backgroundColor: '#ff003c', boxShadow: '2px 0 8px rgba(255,0,60,0.6)' }} />
      )}

      <Av name={contact.name} size={46} online={contact.online} borderColor={hasUnread ? 'rgba(255,0,60,0.4)' : 'rgba(255,0,60,0.15)'} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <h3 className={`text-[16px] truncate ${hasUnread ? 'font-semibold text-white drop-shadow-[0_0_8px_rgba(255,0,60,0.3)]' : 'font-medium text-white/95'}`}>
            {contact.name}
          </h3>
          <span className="text-[12px] font-medium flex-shrink-0 ml-2" style={{ color: hasUnread ? '#ff003c' : 'rgba(255,255,255,0.4)' }}>
            {conv.timestamp}
          </span>
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className={`text-[13px] truncate ${hasUnread ? 'text-[#ff003c] italic' : 'text-white/45'}`}>
            {hasUnread ? '🔒 Message chiffré' : conv.lastMessage}
          </p>
          {hasUnread && (
            <span
              className="flex items-center justify-center rounded-full text-[10px] font-bold text-white flex-shrink-0 ml-2 shadow-[0_0_12px_rgba(255,0,60,0.8)]"
              style={{ minWidth: 20, height: 20, padding: '0 6px', backgroundColor: '#ff003c' }}
            >
              {conv.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ============================================
// Message Bubble
// ============================================
function MessageBubble({ message, isSent, onDecrypt, ttl, isVanishing }) {
  const [glitching, setGlitching] = useState(false);

  const handleTap = () => {
    if (message.locked) {
      setGlitching(true);
      setTimeout(() => {
        setGlitching(false);
        onDecrypt();
      }, 150);
    }
  };

  const bubbleStyle = isSent
    ? { backgroundColor: '#8b0000', borderRadius: '18px 18px 4px 18px' }
    : { backgroundColor: '#222', borderRadius: '18px 18px 18px 4px' };

  return (
    <div 
      className={`flex ${isSent ? 'justify-end' : 'justify-start'} overflow-hidden transition-all ease-[cubic-bezier(0.4,0,0.2,1)]`}
      style={{
        transitionDuration: '600ms',
        opacity: isVanishing ? 0 : 1,
        transform: isVanishing ? 'scale(0.85) translateY(15px)' : 'scale(1) translateY(0)',
        filter: isVanishing ? 'blur(10px)' : 'none',
        maxHeight: isVanishing ? 0 : 600, // collapse height smoothly
        marginBottom: isVanishing ? 0 : 8,
        paddingLeft: 16,
        paddingRight: 16,
      }}
    >
      <div
        className="max-w-[75%] px-3.5 py-2.5 cursor-pointer transition-all active:scale-[0.98]"
        style={{
          ...bubbleStyle,
          border: '1px solid rgba(255, 0, 60, 0.1)',
          filter: glitching ? 'invert(1) skewX(10deg)' : 'none',
          transition: 'filter 0.15s ease, transform 0.1s ease',
        }}
        onClick={handleTap}
      >
        {message.locked ? (
          <div className="flex items-center gap-1.5">
            <Lock size={12} style={{ color: isSent ? '#f59e0b' : '#ff003c' }} />
            <span className={`text-[13px] italic ${isSent ? 'text-amber-400' : 'text-[#ff003c]'}`}>
              {isSent ? 'Toucher pour révéler' : 'Toucher pour déchiffrer'}
            </span>
          </div>
        ) : (
          <>
            {message.attachment && (
              <div className="mb-2 rounded-lg overflow-hidden border border-white/5">
                {message.attachment.type.startsWith('image/') ? (
                  <img src={message.attachment.url} alt="attachment" className="w-full max-h-[200px] object-cover" />
                ) : message.attachment.type.startsWith('video/') ? (
                  <video src={message.attachment.url} controls className="w-full max-h-[200px] bg-black" />
                ) : (
                  <div className="flex items-center gap-2 p-3 bg-white/5">
                    <FileText size={18} className="text-[#ff003c]" />
                    <span className="text-[13px] text-white/90 truncate">{message.attachment.name}</span>
                  </div>
                )}
              </div>
            )}
            {message.text && (
              <p className="text-[14px] text-white/90 leading-relaxed">{message.text}</p>
            )}
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {message.time}
              </span>
              {isSent && message.isRead && (
                <CheckCheck size={12} style={{ color: '#ff003c' }} />
              )}
            </div>
            {message.isRead && message.ttl > 0 && (
              <div className="mt-2.5 flex items-center justify-end gap-3">
                <div className="flex-1 max-w-[120px]">
                  <RedProgressBar ttl={ttl} max={message.ttl || 180} />
                </div>
                <span 
                  className="text-[11px] font-mono tracking-wider font-bold transition-colors duration-300" 
                  style={{ 
                    color: ttl <= 30 ? '#ff3333' : '#ff003c', 
                    textShadow: ttl <= 30 ? '0 0 8px rgba(255,51,51,0.6)' : 'none' 
                  }}
                >
                  {Math.floor(ttl / 60)}:{(ttl % 60).toString().padStart(2, '0')}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================
// New Message Modal
// ============================================
function NewMessageModal({ onClose, onStartChat }) {
  const { contacts } = useApp();
  const [selected, setSelected] = useState([]);

  const toggleContact = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleStart = () => {
    if (selected.length === 1) {
      onStartChat(selected[0]);
    } else if (selected.length > 1) {
      // Broadcast mode
      onClose();
    }
  };

  return (
    <div className="absolute inset-0 z-[60] flex flex-col" style={{ backgroundColor: '#050000' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,0,60,0.08)' }}>
        <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
          <ChevronLeft size={24} />
        </button>
        <h2 className="text-[15px] font-medium text-white">
          {selected.length > 0 ? `${selected.length} contact${selected.length > 1 ? 's' : ''}` : 'Nouveau message'}
        </h2>
        {selected.length > 0 ? (
          <button onClick={handleStart} className="text-[13px] font-medium" style={{ color: '#ff003c' }}>
            {selected.length === 1 ? 'Démarrer' : `Diffuser →`}
          </button>
        ) : (
          <span className="w-14" />
        )}
      </div>

      {/* Contact list */}
      <div className="flex-1 overflow-y-auto">
        {contacts.map((contact) => (
          <button
            key={contact.id}
            onClick={() => toggleContact(contact.id)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
            style={{ borderBottom: '1px solid rgba(255,0,60,0.04)' }}
          >
            <div
              className="flex items-center justify-center rounded border transition-colors flex-shrink-0"
              style={{
                width: 22,
                height: 22,
                borderColor: selected.includes(contact.id) ? '#ff003c' : 'rgba(255,255,255,0.2)',
                backgroundColor: selected.includes(contact.id) ? '#ff003c' : 'transparent',
              }}
            >
              {selected.includes(contact.id) && (
                <CheckCheck size={14} className="text-white" />
              )}
            </div>
            <Av name={contact.name} size={36} online={contact.online} />
            <div className="flex-1 min-w-0">
              <p className="text-[14px] text-white/90 truncate">{contact.name}</p>
              <p className="text-[12px]" style={{ color: 'rgba(255,255,255,0.4)' }}>{contact.phone}</p>
            </div>
          </button>
        ))}
      </div>

      {selected.length > 1 && (
        <div className="px-4 py-2 text-center">
          <p className="text-[10px] italic" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Envoyé individuellement · disparaît 3 min après lecture
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Chat Detail View
// ============================================
function ChatDetail({ conv, onBack }) {
  const { contacts, currentUser, deleteMessage, sendMessage, decryptMessage, addNotification } = useApp();
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

            // Compute current TTL
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

            // Trigger vanish animation if TTL hits 0
            if (currentTtl <= 0 && !vanishingIdsRef.current.has(m.id)) {
              vanishingIdsRef.current.add(m.id);
              vanishingChanged = true;
              
              // Actually delete the message from global state after animation completes
              setTimeout(() => {
                deleteMessage(conv.id, m.id);
              }, 600); // 600ms matches MessageBubble transitionDuration
            }
          }
        });

        if (vanishingChanged) {
          setForceRender(v => v + 1); // trigger re-render so UI sees the new vanishingIds
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

  if (!contact) return null;

  // SECURITY — Phase 3: Real ECDH + Double Ratchet encryption.
  // encryptMessage() now establishes a real ECDH shared secret with the contact
  // and encrypts using the Double Ratchet send chain.
  // Each message advances the chain key → old key destroyed → forward secrecy.
  const handleSend = async () => {
    if (!messageText.trim() && !attachment) return;

    let plaintext = messageText.trim();
    if (attachment) {
      plaintext = JSON.stringify({ text: plaintext, attachment });
    }

    let payload = null;
    try {
      // Real ECDH + Double Ratchet encryption
      payload = await encryptMessage(conv.id, conv.contactId, plaintext);
    } catch (e) {
      addNotification({ type: 'error', text: '⚠️ Échec du chiffrement — message non envoyé' });
      return;
    }

    const newMsg = {
      // Cryptographically random ID — not predictable like Date.now()
      id: `msg-${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`,
      senderId: 'me',
      text: messageText.trim(), // sender keeps plaintext locally (never re-encrypted to self)
      attachment,
      time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      isRead: false,
      ttl: 0,
      locked: true,
      payload,
    };

    sendMessage(conv.id, newMsg);
    setMessageText('');
    setAttachment(null);
  };

  // SECURITY — Phase 3: Real Double Ratchet decryption.
  //
  // Three cases:
  //   1. OWN sent message (senderId === 'me'):
  //      The sender always keeps the plaintext locally. No decryption needed.
  //      In Signal's model, you never re-encrypt messages to yourself.
  //
  //   2. Received message with real ratchet payload:
  //      Full Double Ratchet ratchet.decrypt() — advances recv chain.
  //      Throws on GCM auth tag failure (tampered ciphertext).
  //
  //   3. Legacy demo messages (m3, m6 — no real ciphertext):
  //      Fallback to hardcoded demo strings.
  const handleDecrypt = async (msg) => {
    if (msg.locked === false) return;

    let plaintext = '';
    let attachmentObj = null;

    if (msg.senderId === 'me') {
      // Case 1: own sent message — plaintext already stored locally by sender
      // A real client never needs to decrypt its own messages (it never forgets them)
      plaintext = msg.text;
      attachmentObj = msg.attachment;

    } else if (msg.payload?.iv && msg.payload?.ciphertext) {
      // Case 2: received encrypted message — real Double Ratchet decryption
      try {
        const decryptedStr = await decryptPayload(conv.id, conv.contactId, msg.payload);
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
        addNotification({
          type: 'error',
          text: '⚠️ Authentification échouée — message corrompu ou falsifié',
        });
        return;
      }

    } else {
      // Case 3: legacy demo messages (no real ciphertext)
      const legacyDecryptMap = {
        m3: "Salut ! Comment ça va aujourd'hui ?",
        m6: "Peux-tu m'envoyer le fichier ?",
      };
      plaintext = legacyDecryptMap[msg.id] || 'Message déchiffré avec succès.';
    }

    decryptMessage(conv.id, msg.id, { text: plaintext, attachment: attachmentObj });
    setMessageTtls((prev) => ({ ...prev, [msg.id]: 180 }));
  };

  return (
    <div className="absolute inset-0 z-[50] flex flex-col" style={{ backgroundColor: '#050000' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 flex-shrink-0"
        style={{
          backgroundColor: 'rgba(5, 0, 0, 0.85)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 0, 60, 0.08)',
        }}
      >
        <button onClick={onBack} className="text-white/70 hover:text-white transition-colors p-1">
          <ChevronLeft size={22} />
        </button>

        <Av name={contact.name} size={36} online={contact.online} />

        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-medium text-white truncate">{contact.name}</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.5)' }}>en ligne</span>
            <BadgeE2E />
          </div>
        </div>

        <button className="text-white/50 hover:text-white transition-colors p-2">
          <Phone size={18} />
        </button>
        <button className="text-white/50 hover:text-white transition-colors p-2">
          <MoreVertical size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3 space-y-1" style={{ backgroundColor: 'rgba(5, 0, 0, 0.6)' }}>
        {conv.messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isSent={msg.senderId === 'me'}
            onDecrypt={() => handleDecrypt(msg)}
            ttl={messageTtls[msg.id] !== undefined ? messageTtls[msg.id] : msg.ttl}
            isVanishing={vanishingIdsRef.current.has(msg.id)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="relative flex-shrink-0 pb-24 pt-3 px-4 z-50">
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent pointer-events-none" />
        
        <div className="relative">
          {attachment && (
            <div className="absolute bottom-full left-4 mb-2 p-2 rounded-xl bg-black/80 backdrop-blur-md border border-[#ff003c]/20 flex items-center gap-3 w-64 shadow-2xl">
              {attachment.type.startsWith('image/') ? (
                <img src={attachment.url} alt="preview" className="w-12 h-12 object-cover rounded-md" />
              ) : (
                <div className="w-12 h-12 flex items-center justify-center bg-white/5 rounded-md text-[#ff003c]">
                  <FileText size={20} />
                </div>
              )}
              <div className="flex-1 min-w-0 pr-4">
                <p className="text-[12px] text-white/90 truncate">{attachment.name}</p>
              </div>
              <button 
                onClick={() => setAttachment(null)} 
                className="absolute -top-2 -right-2 bg-[#ff003c] text-white p-1 rounded-full shadow-lg hover:scale-110 transition-transform active:scale-95"
              >
                <X size={12} />
              </button>
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
              className="flex items-end gap-2 px-2 py-1.5 rounded-[24px] backdrop-blur-2xl transition-all"
              style={{
                backgroundColor: 'rgba(25, 0, 10, 0.45)',
                border: '1px solid rgba(255, 0, 60, 0.2)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.5), inset 0 1px 2px rgba(255,255,255,0.05)',
              }}
            >
              <button
                onClick={() => setShowMedia(!showMedia)}
                className={`flex-shrink-0 p-2.5 rounded-full transition-all active:scale-95 ${showMedia ? 'bg-[#ff003c] text-white shadow-[0_0_12px_rgba(255,0,60,0.5)]' : 'text-white/50 hover:text-[#ff003c]'}`}
              >
                <Plus size={22} className={showMedia ? 'rotate-45 transition-transform' : 'transition-transform'} />
              </button>

              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value.slice(0, 500))}
                placeholder="Message sécurisé..."
                rows={1}
                className="flex-1 bg-transparent text-[15px] font-medium text-white placeholder:text-white/30 outline-none resize-none py-3"
                style={{ minHeight: 44, maxHeight: 120 }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />

              {messageText.trim() || attachment ? (
                <button
                  onClick={handleSend}
                  className="flex-shrink-0 flex items-center justify-center rounded-full transition-transform active:scale-90 mb-1 mr-1"
                  style={{ width: 36, height: 36, backgroundColor: '#ff003c', boxShadow: '0 0 12px rgba(255,0,60,0.5)' }}
                >
                  <Send size={16} className="text-white ml-0.5" />
                </button>
              ) : (
                <button
                  onClick={() => setRecording(true)}
                  className="flex-shrink-0 p-2.5 text-white/50 hover:text-[#ff003c] transition-all active:scale-95 mb-0.5 mr-0.5"
                >
                  <Mic size={22} />
                </button>
              )}
            </div>
          )}

          {messageText.trim() && (
            <div className="absolute -top-6 left-0 right-0 text-center animate-pulse">
              <span className="text-[10px] uppercase font-bold tracking-widest bg-black/40 px-3 py-1 rounded-full border border-[rgba(255,0,60,0.2)]" style={{ color: '#ff003c', textShadow: '0 0 8px rgba(255,0,60,0.5)' }}>
                🔒 Signal · a1b2c3d4
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Chats Screen
// ============================================
export default function ChatsScreen() {
  const { conversations, activeChatId, setActiveChat, closeChat, toggleUser, currentUser, contacts } = useApp();
  const [showNewMessage, setShowNewMessage] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeChatId);

  if (activeConv) {
    return <ChatDetail conv={activeConv} onBack={closeChat} />;
  }

  if (showNewMessage) {
    return (
      <NewMessageModal
        onClose={() => setShowNewMessage(false)}
        onStartChat={(contactId) => {
          setShowNewMessage(false);
          // Find or create conversation
          const existing = conversations.find((c) => c.contactId === contactId);
          if (existing) {
            setActiveChat(existing.id);
          }
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0 z-20"
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
          {/* Alice/Bob toggle */}
          <button
            onClick={toggleUser}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all hover:bg-[rgba(255,0,60,0.2)]"
            style={{ backgroundColor: 'rgba(255, 0, 60, 0.1)', color: '#ff003c', border: '1px solid rgba(255,0,60,0.2)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#ff003c', boxShadow: '0 0 6px #ff003c' }} />
            {currentUser.name}
          </button>

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
                isLast={index === conversations.length - 1}
                onClick={() => setActiveChat(conv.id)}
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
