import { useEffect, useState, useCallback } from 'react';
import { 
  Camera, 
  CameraResult, 
  CameraSource,
  PushNotifications,
  LocalNotifications,
  LocalNotificationSchema,
  Filesystem,
  Directory,
  StatusBar,
  Keyboard,
  SplashScreen
} from '@capacitor/plugin';

// ── Camera Hook ────────────────────────────────────────────────────────

export function useCamera() {
  const [hasPermission, setHasPermission] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    Camera.checkPermissions().then((result) => {
      setHasPermission(result.camera === 'granted');
    }).catch(() => {});

    Camera.isAvailable().then(() => {
      setIsSupported(true);
    }).catch(() => {
      setIsSupported(false);
    });
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await Camera.requestPermissions();
    setHasPermission(result.camera === 'granted');
    return result.camera === 'granted';
  }, []);

  const takePicture = useCallback(async (options?: {
    source?: CameraSource;
    quality?: number;
    width?: number;
    height?: number;
  }): Promise<string | null> => {
    if (!hasPermission) {
      const granted = await requestPermission();
      if (!granted) return null;
    }

    try {
      const result: CameraResult = await Camera.getPhoto({
        source: options?.source || 'camera',
        quality: options?.quality || 85,
        width: options?.width || 1280,
        height: options?.height || 1280,
        allowEditing: true,
        correctOrientation: true
      });

      return result.webPath || result.path;
    } catch (e) {
      console.error('Camera error:', e);
      return null;
    }
  }, [hasPermission, requestPermission]);

  return { hasPermission, isSupported, requestPermission, takePicture };
}

// ── Push Notifications Hook ─────────────────────────────────────────────

export function usePushNotifications() {
  const [token, setToken] = useState<string | null>(null);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');

  useEffect(() => {
    // Get current permission status
    PushNotifications.checkPermissions().then((result) => {
      setPermission(result.receive as 'granted' | 'denied' | 'prompt');
    }).catch(() => {});

    // Register for push tokens
    PushNotifications.register().then(() => {
      console.log('Push notifications registered');
    }).catch((e) => {
      console.error('Push registration error:', e);
    });

    // Listen for token
    const removeListener = PushNotifications.addListener('pushNotificationTokenReceived', 
      (event) => {
        setToken(event.token);
        console.log('Push token:', event.token);
      }
    );

    // Listen for notifications
    const removeNotificationListener = PushNotifications.addListener(
      'pushNotificationReceived', 
      (event) => {
        console.log('Push received:', event);
        // Handle received notification
      }
    );

    return () => {
      removeListener.remove();
      removeNotificationListener.remove();
    };
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await PushNotifications.requestPermissions();
    setPermission(result.receive as 'granted' | 'denied' | 'prompt');
    return result.receive === 'granted';
  }, []);

  return { token, permission, requestPermission };
}

// ── Local Notifications Hook ────────────────────────────────────────────

export function useLocalNotifications() {
  const [permission, setPermission] = useState(false);

  useEffect(() => {
    LocalNotifications.checkPermissions().then((result) => {
      setPermission(result.display === 'granted');
    }).catch(() => {});
  }, []);

  const requestPermission = useCallback(async () => {
    const result = await LocalNotifications.requestPermissions();
    setPermission(result.display === 'granted');
    return result.display === 'granted';
  }, []);

  const scheduleNotification = useCallback(async (
    id: number,
    title: string,
    body: string,
    schedule?: { at: Date }
  ) => {
    const notification: LocalNotificationSchema = {
      id,
      title,
      body,
      schedule
    };

    await LocalNotifications.schedule({
      notifications: [notification]
    });
  }, []);

  return { permission, requestPermission, scheduleNotification };
}

// ── File System Hook ─────────────────────────────────────────────────────

export function useFileSystem() {
  const writeFile = useCallback(async (path: string, data: string, encoding: 'utf8' | 'base64' = 'utf8') => {
    await Filesystem.writeFile({
      path,
      data,
      encoding,
      directory: Directory.Documents
    });
  }, []);

  const readFile = useCallback(async (path: string, encoding: 'utf8' | 'base64' = 'utf8') => {
    const result = await Filesystem.readFile({
      path,
      encoding,
      directory: Directory.Documents
    });
    return result.data;
  }, []);

  const deleteFile = useCallback(async (path: string) => {
    await Filesystem.deleteFile({
      path,
      directory: Directory.Documents
    });
  }, []);

  return { writeFile, readFile, deleteFile };
}

// ── Status Bar Hook ─────────────────────────────────────────────────

export function useStatusBar() {
  const setStyle = useCallback(async (style: 'light' | 'dark' | 'default') => {
    await StatusBar.setStyle({ style });
  }, []);

  const setBackgroundColor = useCallback(async (color: string) => {
    await StatusBar.setBackgroundColor({ color });
  }, []);

  const hide = useCallback(async () => {
    await StatusBar.hide();
  }, []);

  const show = useCallback(async () => {
    await StatusBar.show();
  }, []);

  return { setStyle, setBackgroundColor, hide, show };
}

// ── Keyboard Hook ───────────────────────────────────────────────────

export function useKeyboard() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardWillShow', () => {
      setIsVisible(true);
    });
    
    const hideListener = Keyboard.addListener('keyboardWillHide', () => {
      setIsVisible(false);
    });

    return () => {
      showListener.remove();
      hideListener.remove();
    };
  }, []);

  return isVisible;
}

// ── Splash Screen Hook ───────────────────────────────────────────────

export function useSplashScreen() {
  const hide = useCallback(async () => {
    await SplashScreen.hide();
  }, []);

  const show = useCallback(async () => {
    await SplashScreen.show();
  }, []);

  return { hide, show };
}

// ── Export all hooks ──────────────────────────────────────────���─��───

export default {
  useCamera,
  usePushNotifications,
  useLocalNotifications,
  useFileSystem,
  useStatusBar,
  useKeyboard,
  useSplashScreen
};