/* ==========================================================================
   ui/auth.js
   --------------------------------------------------------------------------
   Signing in.

   NO PASSWORDS. Nowhere. A password is a thing to choose badly, forget, reuse
   from somewhere else, and eventually reset - and it buys nothing here, since
   the address has to be proved by email either way. So the code IS the
   sign-in, every time.

   Which leaves one flow rather than two. The first visit asks for a name as
   well, because a name is what the other person sees beside an open document;
   every visit after that is the same request without one.

   SIGNING IN IS OPTIONAL. The studio saves to the local disk whether or not
   anybody has an account. A login only buys the shared workspace, so this is
   a dialog and not a wall.
   ========================================================================== */

import { requestCode, verifyCode, signOut } from '../storage/supabase.js';
import * as dialog from './dialog.js';

const LAST_EMAIL = 'asb-studio:last-email';

/**
 * Opens the account dialog.
 * @param {'signin'|'signup'} startMode
 * @returns {Promise<object|null>} the user, or null if dismissed
 */
export function openAuth(startMode = 'signin') {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'auth';

    let mode = startMode;     // signin | signup
    let sent = false;         // the code is out; show the code field
    let email = '';
    let name = '';

    try { email = localStorage.getItem(LAST_EMAIL) || ''; } catch { /* private mode */ }

    const done = (user) => { dialog.close(); resolve(user); };

    /* --- the two doors ---------------------------------------------------- */
    function tabs() {
      const bar = document.createElement('div');
      bar.className = 'auth__tabs';

      for (const [id, label] of [['signin', 'ورود'], ['signup', 'ثبت‌نام']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'auth__tab';
        button.textContent = label;
        button.setAttribute('aria-pressed', String(mode === id));
        button.addEventListener('click', () => {
          if (mode === id) return;
          mode = id;
          sent = false;       // a code sent for one door is not valid at the other
          render();
        });
        bar.appendChild(button);
      }
      return bar;
    }

    function field(labelText, input, hint) {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = labelText;
      wrap.append(label, input);
      if (hint) {
        const help = document.createElement('div');
        help.className = 'field__hint';
        help.textContent = hint;
        wrap.appendChild(help);
      }
      return wrap;
    }

    function render() {
      root.innerHTML = '';
      root.appendChild(tabs());

      const form = document.createElement('div');
      form.className = 'auth__form';

      /* --- name, first visit only --- */
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'control';
      nameInput.placeholder = 'امیرمحمد شیرازیان';
      nameInput.autocomplete = 'name';
      nameInput.value = name;

      const nameField = field('نام', nameInput, 'همین نام را بقیه کنار سندهای باز می‌بینند.');
      if (mode === 'signup') form.appendChild(nameField);

      /* --- address --- */
      const mail = document.createElement('input');
      mail.type = 'email';
      mail.className = 'control control--ltr';
      mail.placeholder = 'you@example.com';
      mail.autocomplete = 'email';
      mail.value = email;
      mail.disabled = sent;

      form.appendChild(field('ایمیل', mail));

      /* --- code, once it has been sent --- */
      const code = document.createElement('input');
      code.type = 'text';
      code.className = 'control control--ltr auth__code';
      code.placeholder = '۱۲۳۴۵۶';
      code.inputMode = 'numeric';
      code.autocomplete = 'one-time-code';
      code.maxLength = 8;

      if (sent) {
        const hint = document.createElement('p');
        hint.className = 'auth__hint';
        hint.innerHTML = `کدی به <b class="mono">${email}</b> فرستادیم. پوشه‌ی اسپم را هم نگاه کن.`;
        form.appendChild(hint);
        form.appendChild(field('کد', code));
      }

      const error = document.createElement('p');
      error.className = 'auth__error';
      error.hidden = true;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--primary auth__submit';
      button.textContent = sent ? 'ورود' : (mode === 'signup' ? 'فرستادن کد' : 'فرستادن کد');

      const fail = (message) => {
        error.textContent = message;
        error.hidden = false;
        button.disabled = false;
      };

      const send = async () => {
        if (mode === 'signup' && !nameInput.value.trim()) {
          fail('نامت را بنویس — همین را بقیه می‌بینند.');
          return;
        }
        if (!mail.value.includes('@')) {
          fail('ایمیل درست نیست.');
          return;
        }

        button.disabled = true;
        button.textContent = 'در حال فرستادن…';
        error.hidden = true;

        try {
          email = mail.value.trim();
          name = nameInput.value.trim();

          // A name is passed only when signing up, and that is what allows the
          // account to be created. Without one, an unknown address is refused.
          await requestCode(email, mode === 'signup' ? name : null);

          try { localStorage.setItem(LAST_EMAIL, email); } catch { /* private mode */ }
          sent = true;
          render();
        } catch (err) {
          button.textContent = 'فرستادن کد';
          fail(friendly(err, mode));
        }
      };

      const verify = async () => {
        if (code.value.trim().length < 6) {
          fail('کد را کامل بنویس.');
          return;
        }

        button.disabled = true;
        button.textContent = 'در حال بررسی…';
        error.hidden = true;

        try {
          done(await verifyCode(email, code.value));
        } catch (err) {
          button.textContent = 'ورود';
          fail(friendly(err, mode));
          code.select();
        }
      };

      button.addEventListener('click', () => (sent ? verify() : send()));
      mail.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !sent) send(); });
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') verify(); });

      form.appendChild(button);

      if (sent) {
        const again = document.createElement('button');
        again.type = 'button';
        again.className = 'btn btn--quiet auth__link';
        again.textContent = 'ایمیل دیگری';
        again.addEventListener('click', () => { sent = false; render(); });
        form.appendChild(again);
      }

      form.appendChild(error);
      root.appendChild(form);

      const focusOn = sent ? code : (mode === 'signup' && !nameInput.value ? nameInput : mail);
      requestAnimationFrame(() => focusOn.focus());
    }

    render();

    dialog.custom('حساب کاربری', root,
      [{ label: 'بستن', value: null, cancel: true }]).then((result) => {
        if (result === null) resolve(null);
      });
  });
}

/* Supabase answers in English and in error codes. Neither helps here. */
function friendly(err, mode) {
  const message = String((err && err.message) || err || '');

  if (/signups? not allowed|user not found/i.test(message)) {
    return mode === 'signin'
      ? 'این ایمیل حساب ندارد. از «ثبت‌نام» شروع کن.'
      : 'ثبت‌نام تازه بسته است.';
  }
  if (/already registered|already exists/i.test(message)) {
    return 'این ایمیل از قبل حساب دارد. از «ورود» استفاده کن.';
  }
  if (/rate|too many|security purposes/i.test(message)) return 'تعداد تلاش زیاد شد. یک دقیقه صبر کن.';
  if (/expired/i.test(message)) return 'کد منقضی شده. دوباره بخواه.';
  if (/invalid|incorrect|token/i.test(message)) return 'کد درست نیست.';
  if (/network|fetch|failed/i.test(message)) return 'اتصال برقرار نشد. اینترنت را چک کن.';

  return 'مشکلی پیش آمد. دوباره امتحان کن.';
}

export { signOut };
