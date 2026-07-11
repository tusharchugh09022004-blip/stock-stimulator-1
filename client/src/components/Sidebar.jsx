const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'portfolio', label: 'Portfolio', icon: '💼' },
  { id: 'orders', label: 'Orders', icon: '📋' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

const SECTION_MAP = {
  portfolio: 'portfolio-section',
  orders: 'orders-section',
};

export default function Sidebar({ active, onNavigate, onSettingsOpen }) {
  const handleClick = (id) => {
    if (id === 'settings') {
      onSettingsOpen();
    } else if (id === 'dashboard') {
      onNavigate('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      onNavigate(id);
      const sectionId = SECTION_MAP[id];
      if (sectionId) {
        setTimeout(() => {
          const el = document.getElementById(sectionId);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    }
  };

  return (
    <nav className="sidebar">
      <div className="sidebar__logo">
        <img src="/logo.png?v=2" alt="VSS" className="sidebar__logo-img" />
        <span className="sidebar__logo-text">VirtualMoney</span>
      </div>
      <ul className="sidebar__nav">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              className={`sidebar__link ${active === item.id ? 'sidebar__link--active' : ''}`}
              onClick={() => handleClick(item.id)}
            >
              <span className="sidebar__link-icon">{item.icon}</span>
              <span className="sidebar__link-text">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar__version">v1.0</div>
    </nav>
  );
}
