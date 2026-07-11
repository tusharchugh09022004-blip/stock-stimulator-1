import { useEffect } from 'react';

const THEMES = [
  { id: 'dark', label: 'Dark', icon: '\u263E' },
  { id: 'light', label: 'Light', icon: '\u2600' },
];

export default function ThemeToggle({ current, onChange }) {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', current);
    localStorage.setItem('theme', current);
  }, [current]);

  return (
    <div className="theme-selector">
      {THEMES.map((t) => (
        <button
          key={t.id}
          className={`theme-btn ${current === t.id ? 'theme-btn--active' : ''}`}
          onClick={() => onChange(t.id)}
          type="button"
        >
          <span>{t.icon}</span> {t.label}
        </button>
      ))}
    </div>
  );
}
