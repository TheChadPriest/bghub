import { Moon, Settings, Sun } from 'lucide-react';
import { IconButton } from './ui';

export type Route = 'remove' | 'studio' | 'help';

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-display text-[19px] font-bold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M8 8h8v8H8z" fill="var(--accent-ink)" />
        <path d="M16 16h8v8h-8z" fill="var(--accent-ink)" />
        <path d="M16 8h8v8h-8zM8 16h8v8H8z" fill="var(--accent-ink)" opacity=".22" />
      </svg>
      BGhub
    </span>
  );
}

export function Header({ route, theme, onTheme, onSettings }: { route: Route; theme: 'light' | 'dark'; onTheme: () => void; onSettings: () => void }) {
  const link = (r: Route, href: string, label: string) => (
    <a href={href} aria-current={route === r ? 'page' : undefined}
      className={`rounded-lg px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${route === r ? 'bg-panel-2 text-ink' : 'text-muted hover:text-ink'}`}>{label}</a>
  );
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <a href="#/" aria-label="BGhub home" className="mr-1 sm:mr-4"><Logo /></a>
        <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto" aria-label="Main">
          {link('remove', '#/', 'Remove')}
          {link('studio', '#/studio', 'Studio')}
          {link('help', '#/help', 'Help')}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={onTheme}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</IconButton>
          <IconButton label="Settings" onClick={onSettings}><Settings size={17} /></IconButton>
        </div>
      </div>
    </header>
  );
}
