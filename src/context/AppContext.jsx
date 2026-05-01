import React, { createContext, useContext, useReducer, useCallback, useEffect } from 'react';
import { 
  saveMessage, 
  loadConversationMessages, 
  deleteMessage as deleteMessageFromDB,
  wipeAllMessages 
} from '@/crypto/messageDB';

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
          messages: [...c.messages, ...newMessages].sort((a, b) => a.time - b.time)
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
            deleteMessageFromDB(m.id).catch(() => {});
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
      const { id, contactId } = action.payload;
      const newConv = {
        id,
        contactId,
        messages: [],
        lastMessage: 'Démarrer une conversation sécurisée',
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

    case ACTIONS.WIPE_LOCAL_DATA:
      return { ...state, calls: [], conversations: state.conversations.map(c => ({...c, messages: []})) };

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
  
  return {
    activeTab: 'chats',
    activeChatId: null,
    notifications: [],
    loadingProfile: true,
    contacts: savedContacts ? JSON.parse(savedContacts) : [],
    conversations: savedConvs ? JSON.parse(savedConvs) : [],
    calls: savedCalls ? JSON.parse(savedCalls) : [],
    currentUser: { id: null, name: 'Chargement...', phone: '', pseudo: '' },
    securitySettings: savedSecurity ? JSON.parse(savedSecurity) : DEFAULT_SECURITY_SETTINGS,
    stats: { messages: 0, chats: 0, calls: 0 },
    contactsFilter: '',
  };
}

// ============================================
// Provider
// ============================================
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, undefined, buildInitialState);

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

  // TTL countdown
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_TTL' });
    }, 1000);
    return () => clearInterval(interval);
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
          dispatch({ type: ACTIONS.UPDATE_CURRENT_USER, payload: { id: null, pseudo: '', name: 'Alice' } });
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

  const setTab = useCallback((tab) => dispatch({ type: ACTIONS.SET_TAB, payload: tab }), []);
  const setActiveChat = useCallback((id) => dispatch({ type: ACTIONS.SET_ACTIVE_CHAT, payload: id }), []);
  const closeChat = useCallback(() => dispatch({ type: ACTIONS.CLOSE_CHAT }), []);
  const sendMessage = useCallback((convId, message) => dispatch({ type: ACTIONS.SEND_MESSAGE, payload: { convId, message } }), []);
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
    dispatch({ type: ACTIONS.ADD_CALL_LOG, payload: {
      id: `call-${Date.now()}`,
      ...log
    }});
  }, []);

  const createConversation = useCallback((contactId) => {
    const id = `conv-${Date.now()}`;
    dispatch({ 
      type: ACTIONS.CREATE_CONVERSATION, 
      payload: { id, contactId } 
    });
    return id; // return the ID so the caller can setActiveChat(id)
  }, []);

  const value = {
    ...state,
    setTab,
    setActiveChat,
    closeChat,
    sendMessage,
    decryptMessage,
    deleteMessage,
    addNotification,
    dismissNotification,
    updateSecurity,
    addContact,
    setContactsFilter,
    updateCurrentUser,
    wipeLocalData,
    addCallLog,
    createConversation,
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