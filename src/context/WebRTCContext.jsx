import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

import { useApp } from '@/context/AppContext';

const WebRTCContext = createContext(null);

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    ...(import.meta.env.VITE_TURN_SERVER_URL ? [{
      urls: import.meta.env.VITE_TURN_SERVER_URL,
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_PASSWORD,
    }] : []),
  ],
};

export function WebRTCProvider({ children }) {
  const { currentUser, addNotification } = useApp();
  const [ringingCall, setRingingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const peerConnection = useRef(null);
  const signalingChannel = useRef(null);
  const handlersRef = useRef({});
  const callStartTimeRef = useRef(null);

  const { addCallLog } = useApp();

  const setActiveCallFn = useCallback((call) => {
    setActiveCall(call);
  }, []);

  const setRingingCallFn = useCallback((call) => {
    setRingingCall(call);
  }, []);

  const formatTime = () => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const formatDate = () => {
    const now = new Date();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (now.toDateString() === today.toDateString()) return "Aujourd'hui";
    if (now.toDateString() === yesterday.toDateString()) return "Hier";
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(now);
  };

  const cleanup = useCallback(() => {
    // Log the call before clearing state if we have an active or ringing call
    if (activeCall || ringingCall) {
      const duration = callStartTimeRef.current 
        ? Math.floor((Date.now() - callStartTimeRef.current) / 1000) 
        : 0;
      
      const formatDuration = (s) => {
        if (s === 0) return null;
        const mins = Math.floor(s / 60);
        const secs = s % 60;
        return mins > 0 ? `${mins} min ${secs}s` : `${secs}s`;
      };

      const logEntry = {
        contactId: activeCall?.id || ringingCall?.from,
        time: formatTime(),
        date: formatDate(),
        duration: formatDuration(duration),
        type: activeCall ? (activeCall.isOutgoing ? 'outgoing' : 'incoming') : 'missed'
      };

      if (logEntry.contactId) {
        addCallLog(logEntry);
      }
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection.current) {
      peerConnection.current.close();
      peerConnection.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setRingingCall(null);
    callStartTimeRef.current = null;
  }, [localStream, activeCall, ringingCall, addCallLog]);

  const initPeerConnection = useCallback((targetId) => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected') {
        callStartTimeRef.current = Date.now();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && targetId) {
        supabase.channel(`vanish:signaling:${targetId}`).send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { candidate: event.candidate }
        });
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    peerConnection.current = pc;
    return pc;
  }, []);

  const initiateCall = useCallback(async (targetId, contactName = 'Contact', isVideo = false) => {
    try {
      if (!currentUser?.id) {
        addNotification({ type: 'error', text: 'Identité non chargée. Réessayez...' });
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo });
      setLocalStream(stream);

      const pc = initPeerConnection(targetId);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await supabase.channel(`vanish:signaling:${targetId}`).send({
        type: 'broadcast',
        event: 'call-offer',
        payload: {
          from: currentUser?.id,
          fromName: contactName,
          sdp: offer,
          isVideo
        }
      });

      setActiveCall({ id: targetId, name: contactName, status: 'ringing', isOutgoing: true });
    } catch (err) {
      console.error('Failed to initiate call:', err);
      addNotification({ type: 'error', text: 'Échec de l\'appel: ' + err.message });
      cleanup();
    }
  }, [currentUser, initPeerConnection, addNotification, cleanup]);

  const acceptCall = useCallback(async () => {
    if (!ringingCall) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: ringingCall.isVideo });
      setLocalStream(stream);

      const pc = initPeerConnection(ringingCall.from);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(ringingCall.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await supabase.channel(`vanish:signaling:${ringingCall.from}`).send({
        type: 'broadcast',
        event: 'call-answer',
        payload: { sdp: answer }
      });

      setActiveCall({ id: ringingCall.from, name: ringingCall.fromName, status: 'active', isOutgoing: false });
      setRingingCall(null);
    } catch (err) {
      console.error('Failed to accept call:', err);
      addNotification({ type: 'error', text: 'Échec de la connexion' });
      cleanup();
    }
  }, [ringingCall, initPeerConnection, addNotification, cleanup]);

  const declineCall = useCallback(async () => {
    if (!ringingCall) return;
    
    await supabase.channel(`vanish:signaling:${ringingCall.from}`).send({
      type: 'broadcast',
      event: 'call-rejected',
      payload: {}
    });
    cleanup();
  }, [ringingCall, cleanup]);

  const endCall = useCallback(async () => {
    if (activeCall) {
      await supabase.channel(`vanish:signaling:${activeCall.id}`).send({
        type: 'broadcast',
        event: 'call-ended',
        payload: {}
      });
    }
    cleanup();
  }, [activeCall, cleanup]);

  const handleIncomingOffer = useCallback((payload) => {
    setRingingCall(payload);
  }, []);

  const handleAnswer = useCallback(async (sdp) => {
    if (peerConnection.current) {
      await peerConnection.current.setRemoteDescription(new RTCSessionDescription(sdp));
      setActiveCall(prev => prev ? { ...prev, status: 'active' } : null);
    }
  }, []);

  const handleRemoteIceCandidate = useCallback(async (candidate) => {
    if (peerConnection.current) {
      try {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('Error adding ice candidate', e);
      }
    }
  }, []);

  handlersRef.current = { 
    handleIncomingOffer, 
    handleAnswer, 
    handleRemoteIceCandidate,
    cleanup
  };

  useEffect(() => {
    if (!currentUser?.id) return;

    const channelName = `vanish:signaling:${currentUser.id}`;
    signalingChannel.current = supabase.channel(channelName);

    signalingChannel.current
      .on('broadcast', { event: 'call-offer' }, ({ payload }) => {
        handlersRef.current.handleIncomingOffer?.(payload);
      })
      .on('broadcast', { event: 'call-answer' }, ({ payload }) => {
        handlersRef.current.handleAnswer?.(payload.sdp);
      })
      .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
        handlersRef.current.handleRemoteIceCandidate?.(payload.candidate);
      })
      .on('broadcast', { event: 'call-rejected' }, () => {
        handlersRef.current.cleanup?.();
        addNotification({ type: 'error', text: 'Appel refusé' });
      })
      .on('broadcast', { event: 'call-ended' }, () => {
        handlersRef.current.cleanup?.();
      })
      .subscribe();

    return () => {
      if (signalingChannel.current) {
        signalingChannel.current.unsubscribe();
      }
    };
  }, [currentUser?.id, addNotification]);

  const value = {
    localStream,
    remoteStream,
    activeCall,
    ringingCall,
    initiateCall,
    acceptCall,
    declineCall,
    endCall,
    cleanup
  };

  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
}

export function useWebRTC() {
  const ctx = useContext(WebRTCContext);
  if (!ctx) throw new Error('useWebRTC must be inside WebRTCProvider');
  return ctx;
}