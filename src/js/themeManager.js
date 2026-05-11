export class ThemeManager {
  constructor() {
    this.theme = localStorage.getItem('notepad.theme') || this.getSystemTheme();
    this.init();
  }

  init() {
    this.applyTheme(this.theme);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      if (!localStorage.getItem('notepad.theme')) {
        this.applyTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  applyTheme(theme) {
    this.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    
    if (sunIcon && moonIcon) {
      if (theme === 'dark') {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      } else {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      }
    }
  }

  toggle() {
    const newTheme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('notepad.theme', newTheme);
    this.applyTheme(newTheme);
  }
}
