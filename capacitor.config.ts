import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kingvaamp.vanishtext',
  appName: 'VanishText',
  webDir: 'dist',
  plugins: {
    // Push Notifications
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert']
    },
    // Local Notifications
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#000000'
    },
    // Camera
    Camera: {
      cameras: [{ facing: 'environment' }]
    },
    // File System
    Filesystem: {
      directory: 'Documents'
    },
    // Status Bar
    StatusBar: {
      style: 'dark',
      backgroundColor: '#000000'
    },
    // Keyboard
    Keyboard: {
      resizeOnFullScreen: true
    },
    // Splash Screen
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
      showSpinner: true,
      spinnerColor: '#00ff00'
    }
  },
  ios: {
    scheme: 'VanishText'
  },
  android: {
    flavorDimensions: ['vanishtext'],
    buildToolsVersion: '34.0.0'
  }
};

export default config;
