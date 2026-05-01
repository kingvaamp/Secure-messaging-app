import { useEffect, useState, useCallback } from 'react';

// ── Camera Hook ────────────────────────────────────────────────────────

export function useCamera() {
  const [hasPermission, setHasPermission] = useState(false);
  const [isSupported] = useState(false);

  useEffect(() => {
    import('@capacitor/camera').then((CameraModule) => {
      const Camera = (CameraModule as { Camera?: unknown }).Camera || CameraModule.default;
      if (!Camera) return;
      
      (Camera as { checkPermissions?: () => Promise<{ camera?: string }> })?.checkPermissions?.().then((result) => {
        setHasPermission(result?.camera === 'granted');
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const requestPermission = useCallback(async () => {
    const CameraModule = await import('@capacitor/camera');
    const Camera = (CameraModule as { Camera?: unknown }).Camera || CameraModule.default;
    if (!Camera) return false;
    
    const result = await (Camera as { requestPermissions?: () => Promise<{ camera?: string }> })?.requestPermissions?.();
    const granted = result?.camera === 'granted';
    setHasPermission(granted);
    return granted;
  }, []);

  const takePicture = useCallback(async (options?: {
    source?: string;
    quality?: number;
    width?: number;
    height?: number;
  }): Promise<string | null> => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return null;
    }

    try {
      const CameraModule = await import('@capacitor/camera');
      const Camera = (CameraModule as { Camera?: unknown }).Camera || CameraModule.default;
      if (!Camera) return null;
      
      const result = await (Camera as { getPhoto?: (opts: Record<string, unknown>) => Promise<{ webPath?: string; path?: string }> })?.getPhoto?.({
        source: options?.source || 'camera',
        quality: options?.quality || 85,
        width: options?.width || 1280,
        height: options?.height || 1280,
        allowEditing: true,
        correctOrientation: true
      });

      return result?.webPath || result?.path || null;
    } catch {
      return null;
    }
  }, [hasPermission, requestPermission]);

  return { hasPermission, isSupported, requestPermission, takePicture };
}

// ── Push Notifications Hook ─────────────────────────────────────────

export function usePushNotifications() {
  const [permission, setPermission] = useState<string>('prompt');

  useEffect(() => {
    import('@capacitor/push-notifications').then(async (Module) => {
      const PushNotifications = (Module as { PushNotifications?: unknown }).PushNotifications || Module.default;
      if (!PushNotifications) return;
      
      const result = await (PushNotifications as { checkPermissions?: () => Promise<{ receive?: string }> })?.checkPermissions?.();
      if (result) setPermission(result.receive || 'prompt');
    }).catch(() => {});
  }, []);

  const requestPermission = useCallback(async () => {
    const Module = await import('@capacitor/push-notifications');
    const PushNotifications = (Module as { PushNotifications?: unknown }).PushNotifications || Module.default;
    if (!PushNotifications) return false;
    
    const result = await (PushNotifications as { requestPermissions?: () => Promise<{ receive?: string }> })?.requestPermissions?.();
    const granted = result?.receive === 'granted';
    setPermission(granted ? 'granted' : 'denied');
    return granted;
  }, []);

  const register = useCallback(async () => {
    const Module = await import('@capacitor/push-notifications');
    const PushNotifications = (Module as { PushNotifications?: unknown }).PushNotifications || Module.default;
    if (PushNotifications && (PushNotifications as { register?: () => Promise<void> })?.register) {
      await (PushNotifications as { register: () => Promise<void> }).register();
    }
  }, []);

  return { token: null, permission, requestPermission, register };
}

// ── Local Notifications Hook ────────────────────────────────────────────

export function useLocalNotifications() {
  const [permission, setPermission] = useState(false);

  useEffect(() => {
    import('@capacitor/local-notifications').then(async (Module) => {
      const LocalNotifications = (Module as { LocalNotifications?: unknown }).LocalNotifications || Module.default;
      if (!LocalNotifications) return;
      
      const result = await (LocalNotifications as { checkPermissions?: () => Promise<{ display?: string }> })?.checkPermissions?.();
      setPermission(result?.display === 'granted');
    }).catch(() => {});
  }, []);

  const requestPermission = useCallback(async () => {
    const Module = await import('@capacitor/local-notifications');
    const LocalNotifications = (Module as { LocalNotifications?: unknown }).LocalNotifications || Module.default;
    if (!LocalNotifications) return false;
    
    const result = await (LocalNotifications as { requestPermissions?: () => Promise<{ display?: string }> })?.requestPermissions?.();
    const granted = result?.display === 'granted';
    setPermission(granted);
    return granted;
  }, []);

  const scheduleNotification = useCallback(async (
    id: number,
    title: string,
    body: string,
    scheduleAt?: number
  ): Promise<boolean> => {
    if (!permission) {
      const granted = await requestPermission();
      if (!granted) return false;
    }

    try {
      const Module = await import('@capacitor/local-notifications');
      const LocalNotifications = (Module as { LocalNotifications?: unknown }).LocalNotifications || Module.default;
      if (!LocalNotifications) return false;
      
      const notification: Record<string, unknown> = {
        id,
        title,
        body,
      };
      if (scheduleAt) {
        notification.schedule = { at: new Date(scheduleAt) };
      }
      await (LocalNotifications as { schedule?: (opts: { notifications: Record<string, unknown>[] }) => Promise<void> })?.schedule?.({ notifications: [notification] });
      return true;
    } catch {
      return false;
    }
  }, [permission, requestPermission]);

  const cancelNotification = useCallback(async (id: number) => {
    const Module = await import('@capacitor/local-notifications');
    const LocalNotifications = (Module as { LocalNotifications?: unknown }).LocalNotifications || Module.default;
    if (LocalNotifications && (LocalNotifications as { cancel?: (opts: { notifications: { id: number }[] }) => Promise<void> })?.cancel) {
      await (LocalNotifications as { cancel: (opts: { notifications: { id: number }[] }) => Promise<void> }).cancel({ notifications: [{ id }] });
    }
  }, []);

  return { permission, requestPermission, scheduleNotification, cancelNotification };
}

// ── Status Bar Hook ────────────────────────────────────────────────────────

export function useStatusBar() {
  const setStyle = useCallback(async (style: string) => {
    const Module = await import('@capacitor/status-bar');
    const StatusBar = (Module as { StatusBar?: unknown }).StatusBar || Module.default;
    if (StatusBar && (StatusBar as { setStyle?: (opts: { style: string }) => Promise<void> })?.setStyle) {
      await (StatusBar as { setStyle: (opts: { style: string }) => Promise<void> }).setStyle({ style });
    }
  }, []);

  const setBackgroundColor = useCallback(async (color: string) => {
    const Module = await import('@capacitor/status-bar');
    const StatusBar = (Module as { StatusBar?: unknown }).StatusBar || Module.default;
    if (StatusBar && (StatusBar as { setBackgroundColor?: (opts: { color: string }) => Promise<void> })?.setBackgroundColor) {
      await (StatusBar as { setBackgroundColor: (opts: { color: string }) => Promise<void> }).setBackgroundColor({ color });
    }
  }, []);

  const show = useCallback(async () => {
    const Module = await import('@capacitor/status-bar');
    const StatusBar = (Module as { StatusBar?: unknown }).StatusBar || Module.default;
    if (StatusBar && (StatusBar as { show?: () => Promise<void> })?.show) {
      await (StatusBar as { show: () => Promise<void> }).show();
    }
  }, []);

  const hide = useCallback(async () => {
    const Module = await import('@capacitor/status-bar');
    const StatusBar = (Module as { StatusBar?: unknown }).StatusBar || Module.default;
    if (StatusBar && (StatusBar as { hide?: () => Promise<void> })?.hide) {
      await (StatusBar as { hide: () => Promise<void> }).hide();
    }
  }, []);

  return { setStyle, setBackgroundColor, show, hide };
}

// ── Keyboard Hook ────────────────────────────────────────────────────────

export function useKeyboard() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const checkVisibility = () => {
      const keyboardVisible = window.visualViewport?.height 
        ? window.innerHeight - window.visualViewport.height > 100
        : false;
      setIsVisible(keyboardVisible);
    };
    
    window.addEventListener('resize', checkVisibility);
    return () => window.removeEventListener('resize', checkVisibility);
  }, []);

  const show = useCallback(async () => {
    const Module = await import('@capacitor/keyboard');
    const Keyboard = (Module as unknown as { Keyboard?: { show?: () => Promise<void> } }).Keyboard;
    if (Keyboard?.show) {
      await Keyboard.show();
    }
  }, []);

  const hide = useCallback(async () => {
    const Module = await import('@capacitor/keyboard');
    const Keyboard = (Module as unknown as { Keyboard?: { hide?: () => Promise<void> } }).Keyboard;
    if (Keyboard?.hide) {
      await Keyboard.hide();
    }
  }, []);

  return { isVisible, show, hide };
}

// ── Splash Screen Hook ────────────────────────────────────────────────

export function useSplashScreen() {
  const hide = useCallback(async () => {
    const Module = await import('@capacitor/splash-screen');
    const SplashScreen = (Module as { SplashScreen?: unknown }).SplashScreen || Module.default;
    if (SplashScreen && (SplashScreen as { hide?: () => Promise<void> })?.hide) {
      await (SplashScreen as { hide: () => Promise<void> }).hide();
    }
  }, []);

  const show = useCallback(async () => {
    const Module = await import('@capacitor/splash-screen');
    const SplashScreen = (Module as { SplashScreen?: unknown }).SplashScreen || Module.default;
    if (SplashScreen && (SplashScreen as { show?: () => Promise<void> })?.show) {
      await (SplashScreen as { show: () => Promise<void> }).show();
    }
  }, []);

  return { hide, show };
}

// ── File System Hook ─��───────────────────────────────────────────────

export function useFileSystem() {
  const writeFile = useCallback(async (
    path: string,
    data: string,
    directory: string = 'Data'
  ): Promise<boolean> => {
    try {
      const Module = await import('@capacitor/filesystem');
      const Filesystem = (Module as { Filesystem?: unknown }).Filesystem || Module.default;
      if (!Filesystem || !(Filesystem as { writeFile?: (opts: { path: string; data: string; directory: string }) => Promise<void> })?.writeFile) return false;
      
      await (Filesystem as { writeFile: (opts: { path: string; data: string; directory: string }) => Promise<void> }).writeFile({ path, data, directory });
      return true;
    } catch {
      return false;
    }
  }, []);

  const readFile = useCallback(async (
    path: string,
    directory: string = 'Data'
  ): Promise<string | null> => {
    try {
      const Module = await import('@capacitor/filesystem');
      const Filesystem = (Module as { Filesystem?: unknown }).Filesystem || Module.default;
      if (!Filesystem || !(Filesystem as { readFile?: (opts: { path: string; directory: string }) => Promise<{ data: string }> })?.readFile) return null;
      
      const result = await (Filesystem as { readFile: (opts: { path: string; directory: string }) => Promise<{ data: string }> }).readFile({ path, directory });
      return result?.data || null;
    } catch {
      return null;
    }
  }, []);

  const deleteFile = useCallback(async (
    path: string,
    directory: string = 'Data'
  ): Promise<boolean> => {
    try {
      const Module = await import('@capacitor/filesystem');
      const Filesystem = (Module as { Filesystem?: unknown }).Filesystem || Module.default;
      if (!Filesystem || !(Filesystem as { deleteFile?: (opts: { path: string; directory: string }) => Promise<void> })?.deleteFile) return false;
      
      await (Filesystem as { deleteFile: (opts: { path: string; directory: string }) => Promise<void> }).deleteFile({ path, directory });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { writeFile, readFile, deleteFile };
}