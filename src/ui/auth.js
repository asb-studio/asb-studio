/* ==========================================================================
   ui/auth.js
   --------------------------------------------------------------------------
   Signing in and signing up.

   SIGNING IN IS OPTIONAL. The studio writes to the local disk and always has;
   an account only buys the shared workspace. So the door is a dialog rather
   than a wall - anybody can open the app, write, and save, and sign in when
   they want to work with someone else. Locking the whole tool behind a login
   would have been a barrier that bought nothing.

   Three stages, because they are three different moments:

     signin   email and password, every day
     signup   once, with a name and a password. The emailed code only
              confirms the address; the password is what is used from then on.
     confirm  typing that code
     code     the way back in when a password has been forgotten
   ========================================================================== */

import {
  signUp, signInWithPassword, requestCode, verifyCode, verifySignup, signOut,
} from '../storage/supabase.js';
import * as dialog from './dialog.js';

const LAST_EMAIL = 'asb-studio:last-email';

/**
 * Opens the sign-in dialog.
 * @returns {Promise<object|null>} the user, or null if dismissed
 */
export function openAuth(startStage = 'signin') {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'auth';

    let stage = startStage;
    let pendingPassword = '';   // held across the confirm step, never stored
    let email = '';
    try { email = localStorage.getItem(LAST_EMAIL) || ''; } catch { /* private mode */ }

    const done = (user) => { dialog.close(); resolve(user); };

    const render = () => {
      root.innerHTML = '';
      root.appendChild(tabs());
      root.appendChild(
        stage === 'signup' ? signUpForm()
        : stage === 'confirm' ? confirmForm()
        : stage === 'code' ? codeForm()
        : signInForm()
      );
    };

    /* --- the two doors, as a pair of tabs --- */
    function tabs() {
      const bar = document.createElement('div');
      bar.className = 'auth__tabs';

      for (const [id, label] of [['signin', 'ورود'], ['signup', 'ثبت‌نام']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'auth__tab';
        button.textContent = label;
        const active = id === 'signup'
          ? (stage === 'signup' || stage === 'confirm')
          : (stage === 'signin' || stage === 'code');
        button.setAttribute('aria-pressed', String(active));
        button.addEventListener('click', () => { stage = id; render(); });
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

    function input(type, placeholder, value = '', ltr = true) {
      const el = document.createElement('input');
      el.type = type;
      el.className = 'control' + (ltr ? ' control--ltr' : '');
      el.placeholder = placeholder;
      el.value = value;
      return el;
    }

    function errorBox() {
      const el = document.createElement('p');
      el.className = 'auth__error';
      el.hidden = true;
      return el;
    }

    function submitButton(text) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn btn--primary auth__submit';
      el.textContent = text;
      return el;
    }

    /* --- sign in ------------------------------------------------------- */
    function signInForm() {
      const form = document.createElement('div');
      form.className = 'auth__form';

      const mail = input('email', 'you@example.com', email);
      mail.autocomplete = 'email';

      const pass = input('password', '••••••••');
      pass.autocomplete = 'current-password';

      const error = errorBox();
      const button = submitButton('ورود');

      const forgot = document.createElement('button');
      forgot.type = 'button';
      forgot.className = 'btn btn--quiet auth__link';
      forgot.textContent = 'رمز را فراموش کرده‌ام';
      forgot.addEventListener('click', () => { stage = 'code'; render(); });

      const go = async () => {
        if (!mail.value.includes('@') || !pass.value) {
          error.textContent = 'ایمیل و رمز را کامل بنویس.';
          error.hidden = false;
          return;
        }

        button.disabled = true;
        button.textContent = 'در حال ورود…';
        error.hidden = true;

        try {
          const user = await signInWithPassword(mail.value, pass.value);
          remember(mail.value);
          done(user);
        } catch (err) {
          error.textContent = friendly(err);
          error.hidden = false;
          button.disabled = false;
          button.textContent = 'ورود';
        }
      };

      button.addEventListener('click', go);
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

      form.append(
        field('ایمیل', mail),
        field('رمز', pass),
        button, forgot, error);
      return form;
    }

    /* --- sign up -------------------------------------------------------- */
    function signUpForm() {
      const form = document.createElement('div');
      form.className = 'auth__form';

      const name = input('text', 'امیرمحمد شیرازیان', '', false);
      name.autocomplete = 'name';

      const mail = input('email', 'you@example.com', email);
      mail.autocomplete = 'email';

      const pass = input('password', 'دست‌کم ۸ نویسه');
      pass.autocomplete = 'new-password';

      const error = errorBox();
      const button = submitButton('ساختن حساب');

      const go = async () => {
        if (!name.value.trim()) {
          error.textContent = 'نامت را بنویس — همین را بقیه می‌بینند.';
          error.hidden = false;
          return;
        }
        if (!mail.value.includes('@')) {
          error.textContent = 'ایمیل درست نیست.';
          error.hidden = false;
          return;
        }
        if (pass.value.length < 8) {
          error.textContent = 'رمز باید دست‌کم ۸ نویسه باشد.';
          error.hidden = false;
          return;
        }

        button.disabled = true;
        button.textContent = 'در حال ساختن…';
        error.hidden = true;

        try {
          await signUp(mail.value, pass.value, name.value);
          remember(mail.value);

          email = mail.value;
          pendingPassword = pass.value;
          stage = 'confirm';
          render();
        } catch (err) {
          error.textContent = friendly(err);
          error.hidden = false;
          button.disabled = false;
          button.textContent = 'ساختن حساب';
        }
      };

      button.addEventListener('click', go);
      pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

      form.append(
        field('نام', name, 'همین نام را بقیه کنار سندهای باز می‌بینند.'),
        field('ایمیل', mail),
        field('رمز', pass),
        button, error);
      return form;
    }

    /* --- confirming a new account ---------------------------------------
       The code only proves the address is real. The password chosen a moment
       ago is what signs them in from here on, so it is used to complete the
       session rather than making them type it again. */
    function confirmForm() {
      const form = document.createElement('div');
      form.className = 'auth__form';

      const hint = document.createElement('p');
      hint.className = 'auth__hint';
      hint.innerHTML = `کدی به <b class="mono">${email}</b> فرستادیم. پوشه‌ی اسپم را هم نگاه کن.`;

      const code = input('text', '۱۲۳۴۵۶');
      code.maxLength = 8;
      code.inputMode = 'numeric';
      code.autocomplete = 'one-time-code';
      code.classList.add('auth__code');

      const error = errorBox();
      const button = submitButton('تأیید و ورود');

      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn--quiet auth__link';
      back.textContent = 'ایمیل دیگری';
      back.addEventListener('click', () => { stage = 'signup'; render(); });

      const go = async () => {
        if (code.value.trim().length < 6) {
          error.textContent = 'کد را کامل بنویس.';
          error.hidden = false;
          return;
        }

        button.disabled = true;
        button.textContent = 'در حال بررسی…';
        error.hidden = true;

        try {
          const user = await verifySignup(email, code.value);
          done(user);
        } catch (err) {
          // Some projects confirm on sign-up and reject the code as already
          // used. The password still works, so try that before giving up.
          if (pendingPassword) {
            try {
              const user = await signInWithPassword(email, pendingPassword);
              done(user);
              return;
            } catch { /* fall through to the real message */ }
          }

          error.textContent = friendly(err);
          error.hidden = false;
          button.disabled = false;
          button.textContent = 'تأیید و ورود';
          code.select();
        }
      };

      button.addEventListener('click', go);
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

      form.append(hint, field('کد تأیید', code), button, back, error);
      return form;
    }

    /* --- one-time code -------------------------------------------------- */
    function codeForm() {
      const form = document.createElement('div');
      form.className = 'auth__form';

      const mail = input('email', 'you@example.com', email);
      const code = input('text', '۱۲۳۴۵۶');
      code.maxLength = 8;
      code.classList.add('auth__code');

      const codeField = field('کد', code, 'کد را از ایمیل بردار و اینجا بنویس.');
      codeField.hidden = true;

      const error = errorBox();
      const button = submitButton('فرستادن کد');

      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn--quiet auth__link';
      back.textContent = 'ورود با رمز';
      back.addEventListener('click', () => { stage = 'signin'; render(); });

      let sent = false;

      const go = async () => {
        button.disabled = true;
        error.hidden = true;

        try {
          if (!sent) {
            button.textContent = 'در حال فرستادن…';
            await requestCode(mail.value);
            remember(mail.value);
            sent = true;
            codeField.hidden = false;
            button.textContent = 'ورود';
            button.disabled = false;
            code.focus();
            return;
          }

          button.textContent = 'در حال بررسی…';
          const user = await verifyCode(mail.value, code.value);
          done(user);
        } catch (err) {
          error.textContent = friendly(err);
          error.hidden = false;
          button.disabled = false;
          button.textContent = sent ? 'ورود' : 'فرستادن کد';
        }
      };

      button.addEventListener('click', go);
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

      form.append(field('ایمیل', mail), codeField, button, back, error);
      return form;
    }

    function remember(value) {
      try { localStorage.setItem(LAST_EMAIL, value.trim()); } catch { /* private mode */ }
    }

    render();

    dialog.custom('حساب کاربری', root,
      [{ label: 'بستن', value: null, cancel: true }]).then((result) => {
        if (result === null) resolve(null);
      });
  });
}

/* Supabase answers in English and in error codes. Neither helps here. */
function friendly(err) {
  const message = String((err && err.message) || err || '');

  if (/invalid login credentials/i.test(message)) return 'ایمیل یا رمز درست نیست.';
  if (/email not confirmed/i.test(message)) return 'اول ایمیل تأیید را باز کن.';
  if (/already registered|already exists/i.test(message)) return 'این ایمیل از قبل حساب دارد. از «ورود» استفاده کن.';
  if (/rate|too many/i.test(message)) return 'تعداد تلاش زیاد شد. چند دقیقه صبر کن.';
  if (/expired/i.test(message)) return 'کد منقضی شده. دوباره بخواه.';
  if (/invalid|incorrect|token/i.test(message)) return 'کد درست نیست.';
  if (/signups? not allowed/i.test(message)) return 'ثبت‌نام تازه بسته است.';
  if (/password/i.test(message)) return 'رمز باید دست‌کم ۸ نویسه باشد.';
  if (/network|fetch|failed/i.test(message)) return 'اتصال برقرار نشد. اینترنت را چک کن.';

  return 'مشکلی پیش آمد. دوباره امتحان کن.';
}

export { signOut };
