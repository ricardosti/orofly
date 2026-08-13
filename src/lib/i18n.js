import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Dicionário PT -> EN. A chave é o texto exato em português usado no app;
// se uma string não estiver aqui (ou não tiver sido envolvida em t()), ela
// simplesmente continua aparecendo em português — nunca quebra, nunca mostra
// uma chave crua.
export const PT_EN = {
  // Nav / geral
  'Início': 'Home',
  'Agenda': 'Schedule',
  'Equipes': 'Teams',
  'Fazendas': 'Farms',
  'Financeiro': 'Finance',
  'Relatórios': 'Reports',
  'Configurações': 'Settings',
  'Perfil': 'Profile',
  'Sair': 'Sign out',
  'Cancelar': 'Cancel',
  'Salvar': 'Save',
  'Salvando...': 'Saving...',
  '💾 Salvar': '💾 Save',
  'Excluir': 'Delete',
  'Editar': 'Edit',
  'Adicionar': 'Add',
  'Novo': 'New',
  'Nova': 'New',
  'Buscar': 'Search',
  'Pesquisar': 'Search',
  'Voltar': 'Back',
  'Confirmar': 'Confirm',
  'Fechar': 'Close',
  'Ver mais': 'See more',
  'Ver todos': 'See all',
  'Carregando...': 'Loading...',
  'Nenhum resultado encontrado': 'No results found',
  'Nenhum registro encontrado': 'No records found',

  // ProfileModal
  '👤 Meu Perfil': '👤 My Profile',
  'NOME': 'NAME',
  'TELEFONE': 'PHONE',
  'E-MAIL': 'EMAIL',
  'Aparência': 'Appearance',
  'Modo': 'Mode',
  'escuro': 'dark',
  'claro': 'light',
  'Idioma': 'Language',
  'Trocar senha (opcional)': 'Change password (optional)',
  'NOVA SENHA': 'NEW PASSWORD',
  'CONFIRMAR NOVA SENHA': 'CONFIRM NEW PASSWORD',
  'Deixe em branco pra manter a atual': 'Leave blank to keep the current one',
  'A nova senha precisa ter no mínimo 6 caracteres': 'The new password must be at least 6 characters',
  'As senhas não coincidem': 'Passwords do not match',

  // App.jsx
  'Acesso desativado': 'Access disabled',
  'Entre em contato com o administrador.': 'Contact the administrator.',
  'Aplicações Aéreas': 'Aerial Applications',
};

const STORAGE_KEY = 'orofly_lang';

const LanguageContext = createContext({
  lang: 'pt',
  setLang: () => {},
  t: (s) => s,
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved === 'en' ? 'en' : 'pt';
    } catch {
      return 'pt';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignora erro de storage indisponível
    }
  }, [lang]);

  const setLang = (l) => setLangState(l === 'en' ? 'en' : 'pt');

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (str) => (lang === 'en' ? (PT_EN[str] || str) : str),
  }), [lang]);

  return React.createElement(LanguageContext.Provider, { value }, children);
}

export function useLanguage() {
  return useContext(LanguageContext);
}
