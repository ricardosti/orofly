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

// Paleta exclusiva do Painel Admin (Stripe/Linear-style) — deliberadamente separada da
// LIGHT_THEME/DARK_THEME acima, que continuam intactas pro App do Piloto (celular, uso em
// campo). Reaproveita a MESMA infraestrutura de contexto (toggle claro/escuro persistido em
// localStorage) via useAdminTheme() abaixo, só troca qual tabela de cores é devolvida.
export const ADMIN_LIGHT_THEME = {
  bg: '#F8FAFC',
  card: '#FFFFFF',
  cardBorder: '#E2E8F0',
  cardBorder2: '#E2E8F0',
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  textFaint2: '#94A3B8',
  divider: '#F1F5F9',
  divider2: '#EDF2F7',
  primary: '#059669',
  primaryDark: '#047857',
  successBg: '#ECFDF5',
  successText: '#059669',
  dangerBg: '#FEF2F2',
  dangerText: '#DC2626',
  warningBg: '#FFFBEB',
  warningBg2: '#FEF3E2',
  warningText: '#D97706',
  warningText2: '#B45309',
  inputBg: '#FFFFFF',
  inputBorder: '#E2E8F0',
  radius: 8,
};

export const ADMIN_DARK_THEME = {
  bg: '#0B1120',
  card: '#111827',
  cardBorder: '#1F2937',
  cardBorder2: '#1F2937',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textFaint: '#64748B',
  textFaint2: '#64748B',
  divider: '#1E293B',
  divider2: '#1E293B',
  primary: '#10B981',
  primaryDark: '#059669',
  successBg: '#0F2A20',
  successText: '#34D399',
  dangerBg: '#3A1414',
  dangerText: '#F87171',
  warningBg: '#2E2410',
  warningBg2: '#2E2410',
  warningText: '#FBBF24',
  warningText2: '#FBBF24',
  inputBg: '#111827',
  inputBorder: '#1F2937',
  radius: 8,
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

// Mesma fonte de verdade do toggle claro/escuro (contexto/localStorage compartilhado com o
// resto do app), mas devolve a paleta ADMIN_LIGHT_THEME/ADMIN_DARK_THEME em vez da paleta
// padrão — usado só pelo AdminPanel, pra ele ter sua própria identidade visual sem afetar
// o App do Piloto.
export function useAdminTheme() {
  const { themeName, toggleTheme } = useContext(ThemeContext);
  const theme = useMemo(
    () => (themeName === 'dark' ? ADMIN_DARK_THEME : ADMIN_LIGHT_THEME),
    [themeName]
  );
  return { theme, themeName, toggleTheme };
}
