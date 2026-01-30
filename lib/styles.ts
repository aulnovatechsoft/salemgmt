import { Platform } from 'react-native';

interface ShadowStyle {
  shadowColor?: string;
  shadowOffset?: { width: number; height: number };
  shadowOpacity?: number;
  shadowRadius?: number;
  elevation?: number;
  boxShadow?: string;
}

export const createShadow = (
  color: string = '#000000',
  offsetY: number = 2,
  opacity: number = 0.1,
  radius: number = 4,
  elevation: number = 3
): ShadowStyle => {
  if (Platform.OS === 'web') {
    let r = 0, g = 0, b = 0;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      }
    }
    return {
      boxShadow: `0px ${offsetY}px ${radius}px rgba(${r}, ${g}, ${b}, ${opacity})`,
    };
  }
  return {
    shadowColor: color,
    shadowOffset: { width: 0, height: offsetY },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: elevation,
  };
};

export const cardShadow = createShadow('#000000', 2, 0.1, 4, 3);
export const elevatedShadow = createShadow('#000000', 4, 0.15, 8, 6);
export const primaryShadow = (primaryColor: string) => createShadow(primaryColor, 4, 0.15, 12, 6);
export const dangerShadow = createShadow('#D32F2F', 4, 0.15, 12, 6);
