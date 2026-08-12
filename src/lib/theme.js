import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Paleta de cores - modo claro (valores originais do app, para manter o visual idêntico)
export const LIGHT_THEME = {
  bg: '#F4F7F5',
  card: '#fff',
  cardBorder: '#dcebe3',
  cardBorder2: '#d7e6dc',
  text: '#0b1210',
  textMuted: '#5c7568',
  textFaint: '#8fa79a',
  textFaint2: '#7ba38f',
  divider: '#eef5f0',
  divider2: '#e6f0ea',
  primary: '#00A86B',
  primaryDark: '#00875A',
  successBg: '#e3f7ec',
  successText: '#00875A',
  dangerBg: '#fdeaea',
  dangerText: '#e5484d',
  warningBg: '#fff3e0',
  warningBg2: '#fdf3e0',
  warningText: '#f2960f',
  warningText2: '#a3690a',
  inputBg: '#fff',
  inputBorder: '#dcebe3',
};

// Paleta de cores - modo escuro
export const DARK_THEME = {
  bg: '#0f1512',
  card: '#1a231e',
  cardBorder: '#2a362f',
  cardBorder2: '#2a362f',
  text: '#f2f7f4',
  textMuted: '#9db3a6',
  textFaint: '#6f8579',
  textFaint2: '#7fa294',
  divider: '#233029',
  divider2: '#233029',
  primary: '#00A86B',
  primaryDark: '#00875A',
  successBg: '#123626',
  successText: '#3ddc97',
  dangerBg: '#3a1c1c',
  dangerText: '#ff6b6f',
  warningBg: '#3a2c14',
  warningBg2: '#3a2c14',
  warningText: '#f2b04f',
  warningText2: '#f2b04f',
  inputBg: '#1a231e',
  inputBorder: '#2a362f',
};

const STORAGE_KEY = 'orofly_theme';

const ThemeContext = createContext({
  theme: LIGHT_THEME,
  themeName: 'light',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [themeName, setThemeName] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, themeName);
    } catch {
      // ignora erro de storage indisponível
    }
  }, [themeName]);

  const toggleTheme = () => {
    setThemeName((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const value = useMemo(() => ({
    theme: themeName === 'dark' ? DARK_THEME : LIGHT_THEME,
    themeName,
    toggleTheme,
  }), [themeName]);

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}
