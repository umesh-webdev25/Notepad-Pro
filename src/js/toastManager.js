import { createElement } from './utils.js';

export class ToastManager {
  constructor(region) {
    this.region = region;
  }

  show(type, title, message = '', timeout = 3600) {
    const toast = createElement('section', { className: `toast ${type}`, role: 'status' });
    const heading = createElement('p', { className: 'toast-title', text: title });
    const body = createElement('p', { className: 'toast-message', text: message });
    toast.append(heading, body);
    this.region.appendChild(toast);

    window.setTimeout(() => {
      toast.animate(
        [
          { opacity: 1, transform: 'translateY(0)' },
          { opacity: 0, transform: 'translateY(10px)' }
        ],
        { duration: 160, easing: 'ease-in', fill: 'forwards' }
      ).finished.finally(() => toast.remove());
    }, timeout);
  }

  success(title, message) {
    this.show('success', title, message);
  }

  error(title, message) {
    this.show('error', title, message, 5200);
  }

  warning(title, message) {
    this.show('warning', title, message, 5200);
  }

  info(title, message) {
    this.show('info', title, message);
  }
}
