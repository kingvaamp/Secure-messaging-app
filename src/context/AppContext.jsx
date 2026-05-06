import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import {
  saveMessage,
  loadConversationMessages,
  deleteMessage as deleteMessageFromDB,
  wipeAllMessages
} from '@/crypto/messageDB';
import { deleteBlob } from '@/crypto/blobStorage';

const AppContext = createContext(null);

// Security defaults
const DEFAULT_SECURITY_SETTINGS = {
  blockScreenshots: true,
  readReceipts: true,
  faceIdLock: false,
  screenshotAlerts: true,
  notificationSounds: true,
};

// ============================================
// Actions
// ============================================
export const ACTIONS = {
  SET_TAB: 'SET_TAB',
  SET_ACTIVE_CHAT: 'SET_ACTIVE_CHAT',
  CLOSE_CHAT: 'CLOSE_CHAT',
  SEND_MESSAGE: 'SEND_MESSAGE',
  DECRYPT_MESSAGE: 'DECRYPT_MESSAGE',
  DELETE_MESSAGE: 'DELETE_MESSAGE',
  ADD_NOTIFICATION: 'ADD_NOTIFICATION',
  DISMISS_NOTIFICATION: 'DISMISS_NOTIFICATION',
  UPDATE_SECURITY: 'UPDATE_SECURITY',
  ADD_CONTACT: 'ADD_CONTACT',
  SET_CONTACTS_FILTER: 'SET_CONTACTS_FILTER',
  UPDATE_CURRENT_USER: 'UPDATE_CURRENT_USER',
  WIPE_LOCAL_DATA: 'WIPE_LOCAL_DATA',
  CREATE_CONVERSATION: 'CREATE_CONVERSATION',
  SET_LOADING_PROFILE: 'SET_LOADING_PROFILE',
  ADD_CALL_LOG: 'ADD_CALL_LOG',
  CREATE_GROUP: 'CREATE_GROUP',
  ADD_GROUP_MEMBER: 'ADD_GROUP_MEMBER',
  RECEIVE_MESSAGE: 'RECEIVE_MESSAGE',
  DELETE_CONVERSATION: 'DELETE_CONVERSATION',
};

// ============================================
// Reducer
// ============================================
function appReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_LOADING_PROFILE:
      return { ...state, loadingProfile: action.payload };

    case ACTIONS.SET_TAB:
      return { ...state, activeTab: action.payload };

    case ACTIONS.SET_ACTIVE_CHAT: {
      const convId = action.payload;
      return { ...state, activeChatId: convId };
    }

    case ACTIONS.CLOSE_CHAT:
      return { ...state, activeChatId: null };

    case ACTIONS.SEND_MESSAGE: {
      const { convId, message } = action.payload;
      saveMessage({
        id: message.id,
        conversationId: convId,
        text: message.text,
        senderId: message.senderId,
        timestamp: message.time,
        type: message.type,
        attachment: message.attachment,
        payload: message.payload ?? null,
        groupSessionKey: message.groupSessionKey ?? null,
        isGroup: message.isGroup ?? false,
        ttl: message.ttl ?? 0,
        expiresAt: message.expiresAt ?? null,
        status: 'sent'
      }).catch(err => console.warn('Failed to persist message:', err));

      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...c.messages, message],
          lastMessage: message.locked ? '🔒 Message chiffré' : message.text,
          timestamp: message.time,
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.RECEIVE_MESSAGE: {
      const { convId, message } = action.payload;

      // Save to IndexedDB — persist the raw payload so the locked message
      // can be re-decrypted after a reload.
      saveMessage({
        id: message.id,
        conversationId: convId,
        text: message.text || '',
        senderId: message.senderId,
        timestamp: message.time,
        type: message.type || 'text',
        attachment: message.attachment,
        payload: message.payload ?? null,
        groupSessionKey: message.groupSessionKey ?? null,
        isGroup: message.isGroup ?? false,
        ttl: message.ttl ?? 0,
        expiresAt: message.expiresAt ?? null,
        status: 'received'
      }).catch(err => console.warn('Failed to persist received message:', err));

      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: [...c.messages, message],
          lastMessage: message.locked ? '🔒 Message chiffré' : message.text,
          timestamp: message.time,
          unreadCount: state.activeChatId === convId ? 0 : c.unreadCount + 1
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.DECRYPT_MESSAGE: {
      const { convId, msgId, payloadData } = action.payload;
      const text = typeof payloadData === 'string' ? payloadData : payloadData?.text || '';
      const attachment = typeof payloadData === 'object' ? payloadData.attachment : null;
      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map((m) =>
            m.id === msgId ? { ...m, locked: false, text, attachment, isRead: true, ttl: 180, expiresAt: Date.now() + 180000 } : m
          ),
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.DELETE_MESSAGE: {
      const { convId, msgId } = action.payload;
      deleteMessageFromDB(msgId).catch(err => console.warn('Failed to delete message:', err));

      // Clean up the Supabase Storage blob if the deleted message had an
      // encrypted attachment. This is best-effort — a failure here does not
      // block the local delete.
      const convForDelete = state.conversations.find(c => c.id === convId);
      const msgToDelete = convForDelete?.messages.find(m => m.id === msgId);
      const att = msgToDelete?.attachment;
      // We must use the original storage URL. If the user decrypted it, att.url
      // might be 'blob://...', so we check att.encrypted. We should pass the
      // original https:// url to deleteBlob.
      // Wait, deleteBlob requires an http url. The original URL is unfortunately lost
      // if it was overwritten with blob://... 
      // Actually, wait, let's look at ChatsScreen handleDecrypt:
      // it sets attachment: { ...attachmentObj, url: blobUrl }
      // This overwrites the original url in state. 
      // This is a bigger bug! We need to keep the original URL.
      if (att?.encrypted === true && att.originalUrl) {
        deleteBlob(att.originalUrl).catch(() => {});
      } else if (att?.encrypted === true && att.url?.startsWith('http')) {
        deleteBlob(att.url).catch(() => {});
      }

      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.filter((m) => m.id !== msgId),
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.ADD_NOTIFICATION:
      return {
        ...state,
        notifications: [...state.notifications, {
          id: Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''),
          ...action.payload,
        }],
      };

    case ACTIONS.DISMISS_NOTIFICATION:
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.payload),
      };

    case ACTIONS.UPDATE_SECURITY:
      return {
        ...state,
        securitySettings: { ...state.securitySettings, ...action.payload },
      };

    case ACTIONS.ADD_CONTACT:
      return {
        ...state,
        contacts: [...state.contacts, action.payload],
      };

    case ACTIONS.SET_CONTACTS_FILTER:
      return { ...state, contactsFilter: action.payload };

    case 'MERGE_PERSISTED_MESSAGES': {
      const { convId, messages } = action.payload;
      const conversations = state.conversations.map((c) => {
        if (c.id !== convId) return c;
        const existingIds = new Set(c.messages.map(m => m.id));
        const newMessages = messages.filter(m => !existingIds.has(m.id));
        if (newMessages.length === 0) return c;
        return {
          ...c,
          // Sort by the timestamp embedded in the message ID (msg-<timestamp>-...).
          // We cannot sort on `time` because it is a locale string like "14:35",
          // and subtracting strings produces NaN, giving undefined sort order.
          messages: [...c.messages, ...newMessages].sort((a, b) => {
            const tsA = parseInt((a.id || '').split('-')[1]) || 0;
            const tsB = parseInt((b.id || '').split('-')[1]) || 0;
            return tsA - tsB;
          })
        };
      });
      return { ...state, conversations };
    }

    case ACTIONS.UPDATE_CURRENT_USER:
      return {
        ...state,
        currentUser: { ...state.currentUser, ...action.payload },
      };

    case 'TICK_TTL': {
      let changed = false;
      const now = Date.now();
      const conversations = state.conversations.map((c) => {
        let convChanged = false;
        const messages = c.messages.filter((m) => {
          if (m.expiresAt && now >= m.expiresAt) {
            convChanged = true;
            changed = true;
            deleteMessageFromDB(m.id).catch(() => { });
            // Clean up Supabase Storage blob if the expired message had one.
            // Use the original https:// URL (stored in attachment ref) not
            // the transient blob:// URL that may have replaced it after decryption.
            const att = m.attachment;
            if (att?.encrypted === true && att.originalUrl) {
              deleteBlob(att.originalUrl).catch(() => {});
            } else if (att?.encrypted === true && att.url?.startsWith('http')) {
              deleteBlob(att.url).catch(() => {});
            }
            return false;
          }
          return true;
        });
        if (convChanged) {
          const lastMsg = messages[messages.length - 1];
          return {
            ...c,
            messages,
            lastMessage: lastMsg ? (lastMsg.locked ? '🔒 Message chiffré' : lastMsg.text) : 'Conversation vide',
          };
        }
        return c;
      });
      return changed ? { ...state, conversations } : state;
    }

    case ACTIONS.CREATE_CONVERSATION: {
      const { id, contactId, isGroup } = action.payload;
      const newConv = {
        id,
        contactId,
        isGroup: !!isGroup,
        messages: [],
        lastMessage: isGroup ? 'Groupe créé' : 'Démarrer une conversation sécurisée',
        timestamp: 'Maintenant',
        unreadCount: 0,
      };
      return {
        ...state,
        conversations: [newConv, ...state.conversations],
      };
    }

    case ACTIONS.ADD_CALL_LOG: {
      const newCalls = [action.payload, ...state.calls];
      return { ...state, calls: newCalls };
    }

    case ACTIONS.CREATE_GROUP: {
      return { ...state, groups: [action.payload, ...state.groups] };
    }

    case ACTIONS.ADD_GROUP_MEMBER: {
      const { groupId, contactId } = action.payload;
      return {
        ...state,
        groups: state.groups.map(g =>
          g.id === groupId ? { ...g, members: [...new Set([...g.members, contactId])] } : g
        )
      };
    }

    case ACTIONS.DELETE_CONVERSATION: {
      return {
        ...state,
        conversations: state.conversations.filter(c => c.id !== action.payload)
      };
    }

    case ACTIONS.WIPE_LOCAL_DATA:
      return { ...state, calls: [], groups: [], conversations: state.conversations.map(c => ({ ...c, messages: [] })) };

    default:
      return state;
  }
}

// ============================================
// Initial State — Production (no demo data)
// ============================================
function buildInitialState() {
  const savedContacts = localStorage.getItem('vanish_contacts');
  const savedSecurity = localStorage.getItem('vanish_security');
  const savedConvs = localStorage.getItem('vanish_conversations');
  const savedCalls = localStorage.getItem('vanish_calls');
  const savedGroups = localStorage.getItem('vanish_groups');

  return {
    activeTab: 'chats',
    activeChatId: null,
    notifications: [],
    loadingProfile: true,
    contacts: savedContacts ? JSON.parse(savedContacts) : [],
    conversations: savedConvs ? JSON.parse(savedConvs) : [],
    calls: savedCalls ? JSON.parse(savedCalls) : [],
    groups: savedGroups ? JSON.parse(savedGroups) : [],
    currentUser: { id: null, name: 'Chargement...', phone: '', pseudo: '' },
    securitySettings: savedSecurity ? JSON.parse(savedSecurity) : DEFAULT_SECURITY_SETTINGS,
    stats: { messages: 0, chats: 0, calls: 0 },
    contactsFilter: '',
  };
}

// ============================================
// Module-level Crypto-Atomic Send Lock
// ============================================
// A component-local `isSending` state resets whenever the component unmounts.
// For a security app this is not sufficient — if the user navigates away and
// back mid-encryption, the state resets and the same message can be sent twice.
//
// This module-level Set persists for the lifetime of the JS module (i.e. the
// whole app session). The key is the conversation ID. Any concurrent call to
// acquireSendLock() for the same conv returns false, preventing double-sends
// even across component remounts.
const inflightSends = new Set();

function acquireSendLock(convId) {
  if (inflightSends.has(convId)) return false;
  inflightSends.add(convId);
  return true;
}

function releaseSendLock(convId) {
  inflightSends.delete(convId);
}

// ============================================
// Provider
// ============================================
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, undefined, buildInitialState);
  // Always-fresh reference to avoid stale closures in async callbacks
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });

  // Persist contacts
  useEffect(() => {
    localStorage.setItem('vanish_contacts', JSON.stringify(state.contacts));
  }, [state.contacts]);

  // Persist conversations (without messages)
  useEffect(() => {
    const convsToSave = state.conversations.map(c => ({ ...c, messages: [] }));
    localStorage.setItem('vanish_conversations', JSON.stringify(convsToSave));
  }, [state.conversations]);

  // Persist security settings
  useEffect(() => {
    localStorage.setItem('vanish_security', JSON.stringify(state.securitySettings));
  }, [state.securitySettings]);

  // Persist calls
  useEffect(() => {
    localStorage.setItem('vanish_calls', JSON.stringify(state.calls));
  }, [state.calls]);

  // Persist groups to localStorage (fast, offline-first fallback)
  useEffect(() => {
    localStorage.setItem('vanish_groups', JSON.stringify(state.groups));
  }, [state.groups]);

  // ============================================
  // Supabase Group Sync
  // ============================================
  // On login: fetch the user's groups from Supabase and merge with
  // any locally-cached groups. This makes groups survive cache clears
  // and app reinstalls, and ensures members see the group even if
  // the invite arrived while they were offline.
  useEffect(() => {
    const uid = state.currentUser?.id;
    if (!uid) return;
    let mounted = true;

    async function syncGroupsFromSupabase() {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { data, error } = await supabase
          .from('groups')
          .select('id, name, members, created_by, created_at')
          .contains('members', [uid]); // only groups this user is in

        if (error) {
          console.error('🚨 [Vanish Security] Failed to fetch groups from Supabase:', error.message);
          if (error.code === '42501' || error.message.includes('400') || error.code?.startsWith('PGRST')) {
            console.error('🚨 The `groups` table might be missing or lacks RLS policies. Please run the schema.sql migration.');
          }
          return;
        }
        if (!data || !mounted) return;

        const localGroupIds = new Set(stateRef.current.groups.map(g => g.id));
        const remoteOnly = data.filter(g => !localGroupIds.has(g.id));

        for (const group of remoteOnly) {
          dispatch({ type: ACTIONS.CREATE_GROUP, payload: group });
        }
      } catch (e) {
        console.warn('[Groups] Supabase sync failed, using localStorage fallback:', e.message);
      }
    }

    syncGroupsFromSupabase();
    return () => { mounted = false; };
  }, [state.currentUser?.id]);

  // TTL countdown
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_TTL' });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ============================================
  // Message Persistence: Load-back from IndexedDB
  // ============================================
  // Conversations are restored from localStorage (metadata only) on first render.
  // This effect fires once and re-hydrates the actual message bodies from IndexedDB,
  // which is the encrypted local database. Without this, all chat history vanishes
  // on every page reload even though the data was correctly saved.
  useEffect(() => {
    let mounted = true;
    async function hydratePersistedMessages() {
      const convs = stateRef.current.conversations;
      if (!convs || convs.length === 0) return;

      for (const conv of convs) {
        try {
          const msgs = await loadConversationMessages(conv.id);
          if (!mounted || msgs.length === 0) continue;

          // Reconstruct message shape expected by the UI.
          // Persisted messages are stored in locked state — the user must
          // tap to re-reveal them (TTL already expired messages are filtered out).
          const now = Date.now();
          const validMsgs = msgs
            .filter(m => !m.expiresAt || m.expiresAt > now) // drop already-expired
            .map(m => ({
              id: m.id,
              senderId: m.senderId,
              text: m.text || '',
              attachment: m.attachment || null,
              time: m.timestamp
                ? new Date(m.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
                : '',
              isRead: m.status === 'read',
              ttl: m.ttl ?? 0,
              expiresAt: m.expiresAt ?? null,
              locked: true, // always start locked on restore for privacy
              payload: m.payload ?? null,
              groupSessionKey: m.groupSessionKey ?? null,
              isGroup: m.isGroup ?? false,
              persisted: true,
            }));

          if (validMsgs.length === 0) continue;

          dispatch({
            type: 'MERGE_PERSISTED_MESSAGES',
            payload: { convId: conv.id, messages: validMsgs },
          });
        } catch (err) {
          console.warn('[AppContext] Failed to load messages for conv', conv.id, err);
        }
      }
    }

    hydratePersistedMessages();
    return () => { mounted = false; };
    // Run once on mount — stateRef gives us fresh conversations without re-subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ============================================
  // Global Profile Fetch & Sync
  // ============================================
  // We listen to the session in a safe way to avoid circular dependencies
  // with AuthContext while still reacting to login/logout.
  useEffect(() => {
    let mounted = true;

    async function fetchMyProfile(uid) {
      try {
        const { data } = await import('@/lib/supabase').then(m =>
          m.supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
        );

        if (mounted) {
          if (data) {
            dispatch({ type: ACTIONS.UPDATE_CURRENT_USER, payload: data });
          }
          dispatch({ type: ACTIONS.SET_LOADING_PROFILE, payload: false });
        }
      } catch (err) {
        if (mounted) dispatch({ type: ACTIONS.SET_LOADING_PROFILE, payload: false });
      }
    }

    // Direct access to supabase to avoid context circularity
    import('@/lib/supabase').then(m => {
      // 1. Initial check
      m.supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          if (mounted) fetchMyProfile(session.user.id);
        } else {
          if (mounted) dispatch({ type: ACTIONS.SET_LOADING_PROFILE, payload: false });
        }
      });

      // 2. Continuous listen
      const { data: { subscription } } = m.supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user) {
          if (mounted) fetchMyProfile(session.user.id);
        } else if (mounted) {
          // Clear current user on logout
          dispatch({ type: ACTIONS.UPDATE_CURRENT_USER, payload: { id: null, pseudo: '', name: '' } });
          dispatch({ type: ACTIONS.SET_LOADING_PROFILE, payload: false });
        }
      });

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    });

    return () => { mounted = false; };
  }, []);

  // ============================================
  // Global Message Listener (Production)
  // ============================================
  useEffect(() => {
    if (!state.currentUser?.id) return;

    let sub;
    import('@/lib/supabase').then(m => {
      sub = m.supabase.channel(`user-messages-${state.currentUser.id}`)
        .on('broadcast', { event: 'new-message' }, ({ payload }) => {
          const { convId, message } = payload;

          // 1. Ensure conversation exists
          const existing = state.conversations.find(c => c.id === convId);
          if (!existing) {
            // Auto-create conversation thread
            const isGroup = message.isGroup || convId.includes('group');
            const contactId = isGroup ? (message.groupId || 'group-unknown') : message.senderId;

            // If it's a group we don't know yet, create the group object locally too
            if (isGroup && message.groupId && !state.groups.find(g => g.id === message.groupId)) {
              dispatch({
                type: ACTIONS.CREATE_GROUP,
                payload: {
                  id: message.groupId,
                  name: message.groupName || 'Groupe Inconnu',
                  members: message.groupMembers || [],
                  createdAt: Date.now()
                }
              });
            }

            dispatch({
              type: ACTIONS.CREATE_CONVERSATION,
              payload: { id: convId, contactId, isGroup }
            });
          }

          // 2. Dispatch receive
          dispatch({ type: ACTIONS.RECEIVE_MESSAGE, payload: { convId, message } });
        })
        .subscribe();
    });

    return () => {
      if (sub) sub.unsubscribe();
    };
  }, [state.currentUser?.id, state.conversations]);

  const setTab = useCallback((tab) => dispatch({ type: ACTIONS.SET_TAB, payload: tab }), []);
  const setActiveChat = useCallback((id) => dispatch({ type: ACTIONS.SET_ACTIVE_CHAT, payload: id }), []);
  const closeChat = useCallback(() => dispatch({ type: ACTIONS.CLOSE_CHAT }), []);
  const sendMessage = useCallback(async (convId, message) => {
    // 1. Persist/Update Local UI State immediately
    dispatch({ type: ACTIONS.SEND_MESSAGE, payload: { convId, message } });

    // 2. Network signaling — 1:1 conversations only.
    //    Group messages are routed through sendGroupMessage() which owns
    //    the entire fan-out (encrypt per member, broadcast, local dispatch).
    //    This function must NEVER call encryptMessage for groups to avoid
    //    double-advancing the ratchet chain.
    const currentState = stateRef.current;
    const conv = currentState.conversations.find(c => c.id === convId);
    if (!conv) {
      console.warn('[sendMessage] Conv not found for id:', convId);
      return;
    }
    if (conv.isGroup || conv.contactId.startsWith('group-')) return;

    // 1:1 Message signaling
    const { supabase } = await import('@/lib/supabase');
    supabase.channel(`user-messages-${conv.contactId}`).send({
      type: 'broadcast',
      event: 'new-message',
      payload: {
        convId,
        message: { ...message, senderId: currentState.currentUser.id }
      }
    });
  }, []); // Empty deps — always reads fresh state via stateRef

  // ============================================
  // Group Message Fan-out (Single Source of Truth)
  // ============================================
  // This is the ONLY place that calls encryptMessage() for group sends.
  // ChatsScreen delegates here rather than calling encryptMessage directly,
  // preventing the architecture debt where the ratchet could advance twice.
  //
  // Flow:
  //   ChatsScreen.handleSend (group) → sendGroupMessage()
  //     → encryptMessage(convId::memberId, memberId, plaintext)  [once per member]
  //     → supabase broadcast to each member
  //     → dispatch(SEND_MESSAGE) for local UI
  const sendGroupMessage = useCallback(async (convId, plaintext, displayMsg) => {
    const currentState = stateRef.current;
    const conv = currentState.conversations.find(c => c.id === convId);
    if (!conv || !conv.isGroup) {
      console.warn('[sendGroupMessage] Not a group conv:', convId);
      return;
    }
    const group = currentState.groups.find(g => g.id === conv.contactId);
    if (!group) {
      console.warn('[sendGroupMessage] Group not found:', conv.contactId);
      return;
    }

    const { supabase } = await import('@/lib/supabase');
    const { encryptMessage } = await import('@/crypto/sessionManager');
    const myId = currentState.currentUser.id;
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    // Fan-out: one pairwise encrypted message per recipient
    for (const memberId of group.members) {
      if (memberId === myId) continue;
      const lockKey = `group-fanout::${convId}::${memberId}`;
      if (!acquireSendLock(lockKey)) continue;
      try {
        const groupSessionKey = `${convId}::${memberId}`;
        const payload = await encryptMessage(groupSessionKey, memberId, plaintext);
        supabase.channel(`user-messages-${memberId}`).send({
          type: 'broadcast',
          event: 'new-message',
          payload: {
            convId,
            message: {
              id: `msg-${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`,
              senderId: myId,
              text: displayMsg.text,
              attachment: displayMsg.attachment ?? null,
              time,
              isRead: false,
              ttl: 0,
              locked: true,
              payload,
              groupSessionKey,
              isGroup: true,
              groupId: conv.contactId,
              groupName: group.name,
              groupMembers: group.members,
            }
          }
        });
      } catch (e) {
        console.warn(`[sendGroupMessage] Fan-out failed for ${memberId}:`, e);
      } finally {
        releaseSendLock(lockKey);
      }
    }

    // Save the sender's own copy locally (plaintext, not encrypted)
    const localMsg = {
      id: `msg-${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`,
      senderId: 'me',
      text: displayMsg.text,
      attachment: displayMsg.attachment ?? null,
      time,
      isRead: false,
      ttl: 0,
      locked: true,
      payload: null, // sender stores plaintext in 'text', no need to re-decrypt
      isGroup: true,
    };
    dispatch({ type: ACTIONS.SEND_MESSAGE, payload: { convId, message: localMsg } });
  }, []); // Empty deps — always reads fresh state via stateRef

  const decryptMessage = useCallback((convId, msgId, payloadData) => dispatch({ type: ACTIONS.DECRYPT_MESSAGE, payload: { convId, msgId, payloadData } }), []);
  const deleteMessage = useCallback((convId, msgId) => dispatch({ type: ACTIONS.DELETE_MESSAGE, payload: { convId, msgId } }), []);
  const addNotification = useCallback((notif) => dispatch({ type: ACTIONS.ADD_NOTIFICATION, payload: notif }), []);
  const dismissNotification = useCallback((id) => dispatch({ type: ACTIONS.DISMISS_NOTIFICATION, payload: id }), []);
  const updateSecurity = useCallback((settings) => dispatch({ type: ACTIONS.UPDATE_SECURITY, payload: settings }), []);
  const addContact = useCallback((contact) => dispatch({ type: ACTIONS.ADD_CONTACT, payload: contact }), []);
  const setContactsFilter = useCallback((filter) => dispatch({ type: ACTIONS.SET_CONTACTS_FILTER, payload: filter }), []);
  const updateCurrentUser = useCallback((updates) => dispatch({ type: ACTIONS.UPDATE_CURRENT_USER, payload: updates }), []);

  const wipeLocalData = useCallback(async () => {
    await wipeAllMessages();
    dispatch({ type: ACTIONS.WIPE_LOCAL_DATA });
  }, []);

  const addCallLog = useCallback((log) => {
    dispatch({
      type: ACTIONS.ADD_CALL_LOG, payload: {
        id: `call-${Date.now()}`,
        ...log
      }
    });
  }, []);

  const createGroup = useCallback(async (name, memberIds) => {
    const id = `group-${Date.now()}`;
    const groupPayload = { id, name, members: memberIds, createdAt: Date.now() };

    // 1. Optimistic local update — instant UI response
    dispatch({ type: ACTIONS.CREATE_GROUP, payload: groupPayload });

    // 2. Persist to Supabase so all members and future devices see the group
    try {
      const { supabase } = await import('@/lib/supabase');
      const { error } = await supabase.from('groups').insert({
        id,
        name,
        members: memberIds,
        created_by: stateRef.current.currentUser?.id,
        created_at: new Date().toISOString(),
      });
      if (error) {
        console.error('🚨 [Vanish Security] Supabase persist failed — group saved locally only:', error.message);
        if (error.code === '42501' || error.message.includes('400') || error.code?.startsWith('PGRST')) {
          console.error('🚨 RLS Policy or schema error on `groups` table. Did you create it manually without running schema.sql? Run the schema.sql migration!');
        }
      }
    } catch (e) {
      console.warn('[Groups] Supabase persist failed — group saved locally only:', e.message);
    }

    return id;
  }, []);

  const createConversation = useCallback((contactId, isGroup = false) => {
    const id = isGroup ? `conv-group-${Date.now()}` : `conv-${Date.now()}`;
    dispatch({
      type: ACTIONS.CREATE_CONVERSATION,
      payload: { id, contactId, isGroup }
    });
    return id;
  }, []);

  const deleteConversation = useCallback((id) => dispatch({ type: ACTIONS.DELETE_CONVERSATION, payload: id }), []);

  const sendBroadcast = useCallback(async (contactIds, message) => {
    const { supabase } = await import('@/lib/supabase');
    const { encryptMessage } = await import('@/crypto/sessionManager');

    let plaintext = message.text;
    if (message.attachment) {
      plaintext = JSON.stringify({ text: message.text, attachment: message.attachment });
    }

    // ── Fix: pre-build convIdMap before the loop ─────────────────────────
    // React batches `dispatch()` calls — a CREATE_CONVERSATION dispatched in
    // iteration N is NOT visible via stateRef.current in iteration N+1 within
    // the same synchronous tick. We maintain a local map that we update
    // immediately as we create conversations, bypassing the batching issue.
    const snapshot = stateRef.current;
    const convIdMap = new Map(
      snapshot.conversations
        .filter(c => !c.isGroup)
        .map(c => [c.contactId, c.id])
    );

    for (const contactId of contactIds) {
      // ── Crypto-atomic lock per conversation ──────────────────────────
      // Uses the module-level inflightSends Set — survives component remounts.
      const lockKey = `broadcast::${contactId}`;
      if (!acquireSendLock(lockKey)) {
        console.warn(`[Broadcast] Already sending to ${contactId} — skipped`);
        continue;
      }

      try {
        // Resolve or create the conversation ID from our local map
        let convId = convIdMap.get(contactId);
        if (!convId) {
          convId = `conv-${Date.now()}-${contactId.substring(0, 4)}`;
          // Register immediately in local map so subsequent iterations see it
          convIdMap.set(contactId, convId);
          dispatch({ type: ACTIONS.CREATE_CONVERSATION, payload: { id: convId, contactId, isGroup: false } });
        }

        const payload = await encryptMessage(convId, contactId, plaintext);

        // Unique message ID per recipient — prevents IndexedDB / React key collisions
        const uniqueMsg = {
          ...message,
          id: `msg-${Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('')}`,
        };

        supabase.channel(`user-messages-${contactId}`).send({
          type: 'broadcast',
          event: 'new-message',
          payload: { convId, message: { ...uniqueMsg, payload, locked: true } }
        });

        // Save locally to the specific conversation
        dispatch({ type: ACTIONS.SEND_MESSAGE, payload: { convId, message: uniqueMsg } });

      } catch (e) {
        console.warn(`[Broadcast] Failed for ${contactId}:`, e);
      } finally {
        releaseSendLock(lockKey);
      }
    }
  }, []); // Empty deps — uses stateRef + module-level lock

  const value = {
    ...state,
    setTab,
    setActiveChat,
    closeChat,
    sendMessage,
    sendGroupMessage,
    sendBroadcast,
    decryptMessage,
    deleteMessage,
    deleteConversation,
    addNotification,
    dismissNotification,
    updateSecurity,
    addContact,
    setContactsFilter,
    updateCurrentUser,
    wipeLocalData,
    addCallLog,
    createGroup,
    createConversation,
    // Module-level crypto-atomic send lock — survives component remounts.
    // ChatsScreen uses these instead of local isSending state.
    acquireSendLock,
    releaseSendLock,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}