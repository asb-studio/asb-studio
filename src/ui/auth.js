/* ==========================================================================
   ui/auth.js
   --------------------------------------------------------------------------
   The sign-in screen.

   Email and a one-time code, not a shared password. A shared password would
   be simpler for about a week, and then nobody would be able to say which of
   you saved a given change - which is the one thing the workspace exists to
   record.

   The screen covers everything until somebody is signed in, and it is the
   only part of the studio that runs before a document is loaded.
   ========================================================================== */

import { requestCode, verifyCode, currentUser, signOut } from '../storage/supabase.js';

const LAST_EMAIL = 'asb-studio:last-email';

export class AuthGate {
  constructor(root) {
    this.root = root;
    this.email = '';
    this.stage = 'email';
  }

  /**
   * Shows the screen and resolves once somebody is signed in.
   * Resolves straight away when a session is already stored.
   */
  async require() {
    const user = await currentUser();
    if (user) return user;

    return new Promise((resolve) => {
      this.resolve = resolve;
      this.root.hidden = false;
      this._render();
    });
  }

  hide() { this.root.hidden = true; }

  _render() {
    this.root.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'gate';

    const mark = document.createElement('div');
    mark.className = 'gate__mark';
    mark.dataset.logo = '';
    mark.setAttribute('role', 'img');
    mark.setAttribute('aria-label', 'نشان نشر اسب');

    const title = document.createElement('h1');
    title.className = 'gate__title';
    title.textContent = 'استودیوی اسب';

    card.append(mark, title);
    card.appendChild(this.stage === 'email' ? this._emailStage() : this._codeStage());

    this.root.appendChild(card);

    const first = card.querySelector('input');
    if (first) first.focus();

    // The mark is drawn by ui/logo.js, which may not have run yet.
    import('./logo.js').then((m) => m.mountLogos(this.root)).catch(() => {});
  }

  _emailStage() {
    const form = document.createElement('div');
    form.className = 'gate__form';

    const hint = document.createElement('p');
    hint.className = 'gate__hint';
    hint.textContent = 'ایمیلت را بنویس. یک کد شش‌رقمی برایت می‌فرستیم.';

    const input = document.createElement('input');
    input.type = 'email';
    input.className = 'control control--ltr';
    input.placeholder = 'you@example.com';
    input.autocomplete = 'email';
    try { input.value = localStorage.getItem(LAST_EMAIL) || ''; } catch { /* private mode */ }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary gate__submit';
    button.textContent = 'فرستادن کد';

    const error = document.createElement('p');
    error.className = 'gate__error';
    error.hidden = true;

    const submit = async () => {
      const value = input.value.trim();
      if (!value || !value.includes('@')) {
        error.textContent = 'ایمیل درست نیست.';
        error.hidden = false;
        return;
      }

      button.disabled = true;
      button.textContent = 'در حال فرستادن…';
      error.hidden = true;

      try {
        await requestCode(value);
        this.email = value;
        try { localStorage.setItem(LAST_EMAIL, value); } catch { /* private mode */ }
        this.stage = 'code';
        this._render();
      } catch (err) {
        error.textContent = friendlyError(err);
        error.hidden = false;
        button.disabled = false;
        button.textContent = 'فرستادن کد';
      }
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    form.append(hint, input, button, error);
    return form;
  }

  _codeStage() {
    const form = document.createElement('div');
    form.className = 'gate__form';

    const hint = document.createElement('p');
    hint.className = 'gate__hint';
    hint.innerHTML = `کد را به <b class="mono">${this.email}</b> فرستادیم. پوشه‌ی اسپم را هم نگاه کن.`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'control control--ltr gate__code';
    input.placeholder = '۱۲۳۴۵۶';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.maxLength = 6;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary gate__submit';
    button.textContent = 'ورود';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn btn--quiet';
    back.textContent = 'ایمیل دیگری';
    back.addEventListener('click', () => { this.stage = 'email'; this._render(); });

    const error = document.createElement('p');
    error.className = 'gate__error';
    error.hidden = true;

    const submit = async () => {
      const code = input.value.trim();
      if (code.length < 6) {
        error.textContent = 'کد شش رقم است.';
        error.hidden = false;
        return;
      }

      button.disabled = true;
      button.textContent = 'در حال بررسی…';
      error.hidden = true;

      try {
        const user = await verifyCode(this.email, code);
        this.hide();
        if (this.resolve) this.resolve(user);
      } catch (err) {
        error.textContent = friendlyError(err);
        error.hidden = false;
        button.disabled = false;
        button.textContent = 'ورود';
        input.select();
      }
    };

    button.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    form.append(hint, input, button, back, error);
    return form;
  }
}

/* Supabase speaks English and in error codes. Neither helps here. */
function friendlyError(err) {
  const message = String((err && err.message) || err || '');

  if (/rate|too many/i.test(message)) return 'تعداد تلاش زیاد شد. چند دقیقه صبر کن.';
  if (/expired/i.test(message)) return 'کد منقضی شده. دوباره بخواه.';
  if (/invalid|incorrect/i.test(message)) return 'کد درست نیست.';
  if (/signups? not allowed|not authorized/i.test(message)) {
    return 'این ایمیل اجازه‌ی ورود ندارد.';
  }
  if (/network|fetch/i.test(message)) return 'اتصال برقرار نشد. اینترنت را چک کن.';

  return 'مشکلی پیش آمد. دوباره امتحان کن.';
}

export { signOut };
