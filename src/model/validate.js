/* ==========================================================================
   model/validate.js
   --------------------------------------------------------------------------
   Checks a document is publishable before it is published.

   These are not Markdown mistakes - lint.js covers those. These are the ways
   a perfectly valid file can still come out wrong on the site: a slug with a
   space in it, a premium work with no price, a date in the wrong shape. Every
   one of them currently passes through build.py without a word.

   Severity is either 'block' - build.py will produce something broken - or
   'warn', which is survivable but probably not what was meant.

   This module must never touch the DOM.
   ========================================================================== */

import { CATEGORIES, LEGACY_CATEGORIES, MARKERS, SOCIAL_NETWORKS } from './schema.js';
import { countChanges } from '../markdown/critic.js';
import { detectType } from './doctype.js';

const SLUG_OK = /^[a-z0-9][a-z0-9-]*$/;
const DATE_OK = /^\d{4}-\d{2}-\d{2}$/;
const UUID_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function issue(field, severity, message) {
  return { field, severity, message };
}

/**
 * @param {import('./document.js').AsbDocument} doc
 * @returns {Array<{field, severity, message}>}
 */
/* --------------------------------------------------------------------------
   The file name

   The name on disk becomes part of the published address, so an apostrophe,
   a space or a capital letter in it lands in the URL - where an apostrophe
   gets percent-encoded into %27 and the link stops being something anyone can
   read out loud or paste into a message. Nothing warns about it today, which
   is how geever's-flight.md happens.
   -------------------------------------------------------------------------- */

const FILENAME_OK = /^[a-z0-9][a-z0-9-]*\.(md|markdown)$/;

export function validateFileName(name) {
  const text = String(name || '').trim();
  if (!text || text === 'بدون‌نام.md') return [];
  if (FILENAME_OK.test(text)) return [];

  const problems = [];
  if (/['’`"]/.test(text)) problems.push('آپاستروف');
  if (/\s/.test(text)) problems.push('فاصله');
  if (/[A-Z]/.test(text)) problems.push('حرف بزرگ');
  if (/[\u0600-\u06FF]/.test(text)) problems.push('حرف فارسی');
  if (/[_]/.test(text)) problems.push('زیرخط');

  const found = problems.length ? problems.join('، ') : 'کاراکتر غیرمجاز';
  const suggestion = text
    .toLowerCase()
    .replace(/\.(md|markdown)$/, '')
    .replace(/['’`"]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  return [{
    field: 'filename',
    severity: 'warn',
    message: `نام فایل ${found} دارد و همین نام در آدرس صفحه می‌آید. فقط حروف کوچک انگلیسی، رقم و خط تیره بگذار` +
             (suggestion ? ` — مثلاً ${suggestion}.md` : '') + '.',
  }];
}

export function validateDocument(doc) {
  // A creator profile is a different kind of document with different rules.
  // Judging it by a story's checklist is what buried it in warnings about
  // fields it is not supposed to have.
  if (detectType(doc) === 'creator') return validateCreator(doc);

  const fm = doc.frontmatter;
  const body = doc.body;
  const out = [];

  const title = String(fm.get('title') || '').trim();
  if (!title) out.push(issue('title', 'block', 'عنوان خالی است. صفحه بدون عنوان ساخته می‌شود.'));

  const slug = String(fm.get('slug') || '').trim();
  if (!slug) {
    out.push(issue('slug', 'block', 'اسلاگ خالی است. build.py نام فایل را جایش می‌گذارد که معمولاً آن چیزی نیست که می‌خواهی.'));
  } else if (!SLUG_OK.test(slug)) {
    out.push(issue('slug', 'block',
      'اسلاگ فقط باید حروف کوچک انگلیسی، رقم و خط تیره داشته باشد. فاصله و حرف فارسی آدرس صفحه را خراب می‌کند.'));
  }

  const category = String(fm.get('category') || '').trim();
  if (!category) {
    out.push(issue('category', 'block', 'دسته‌بندی انتخاب نشده.'));
  } else if (LEGACY_CATEGORIES[category]) {
    out.push(issue('category', 'warn',
      `دسته‌ی قدیمی است. build.py خودش به ${LEGACY_CATEGORIES[category]} ترجمه‌اش می‌کند، ولی بهتر است همین‌جا عوضش کنی.`));
  } else if (!CATEGORIES[category]) {
    out.push(issue('category', 'block', `دسته‌ی «${category}» در build.py تعریف نشده. صفحه‌ی آرشیوش ساخته نمی‌شود.`));
  }

  const date = String(fm.get('date') || '').trim();
  if (!date) {
    out.push(issue('date', 'warn', 'تاریخ خالی است. مرتب‌سازی آرشیو به هم می‌ریزد.'));
  } else if (!DATE_OK.test(date)) {
    out.push(issue('date', 'block', 'قالب تاریخ باید ۱۴۰۵-۰۳-۳۱ باشد، با رقم انگلیسی و خط تیره.'));
  }

  const bookId = String(fm.get('book_id') || '').trim();
  if (!bookId) {
    out.push(issue('book_id', 'warn', 'شناسه‌ی کتاب ندارد. برای آثار پولی لازم است.'));
  } else if (!UUID_OK.test(bookId)) {
    out.push(issue('book_id', 'warn', 'شکل شناسه‌ی کتاب استاندارد نیست.'));
  }

  const premium = fm.get('premium') === true;
  if (premium) {
    if (!body.includes(MARKERS.paywall)) {
      out.push(issue('premium', 'block',
        'اثر پولی است ولی دیوار پرداخت ندارد. build.py کل متن را مسدود می‌کند و به‌جایش هشدار امنیتی چاپ می‌کند.'));
    }
    const price = Number(fm.get('price'));
    if (!Number.isFinite(price) || price <= 0) {
      out.push(issue('price', 'block', 'اثر پولی با قیمت صفر به سوپابیس می‌رود.'));
    }
    if (!bookId) {
      out.push(issue('book_id', 'block', 'اثر پولی بدون شناسه‌ی کتاب، به خریدار وصل نمی‌شود.'));
    }
  }

  if (fm.get('reader') === true && !body.includes(MARKERS.ereader)) {
    out.push(issue('reader', 'warn',
      'حالت مطالعه فعال است ولی نقطه‌ی شروع مطالعه گذاشته نشده. صفحه بدون مقدمه ساخته می‌شود.'));
  }

  /* --- پیش‌خرید و تخفیف — RAHNAMANEVESHTAN.md، بخش یازده ------------------ */

  const releaseDate = String(fm.get('release_date') || '').trim();
  if (releaseDate) {
    if (premium !== true) {
      out.push(issue('release_date', 'block',
        'تاریخ پیش‌خرید دارد ولی premium روشن نیست. با premium: false متن اثر اصلاً رندر نمی‌شود و صفحه فقط معرفی و شمارش معکوس می‌ماند.'));
    }
    if (!DATE_OK.test(releaseDate)) {
      out.push(issue('release_date', 'block', 'قالب release_date باید "1405-08-01" باشد، گیومه‌دار و دورقمی.'));
    }
    if (!fm.has('preorder_price')) {
      out.push(issue('preorder_price', 'warn', 'قیمت پیش‌خرید ندارد؛ تا روز انتشار همان price نشان داده می‌شود.'));
    }
    if (!fm.has('formats')) {
      out.push(issue('formats', 'warn', 'فهرست قالب‌های عرضه خالی است — روی صفحه‌ی پیش‌خرید چاپ می‌شود.'));
    }
  }

  const releaseTime = String(fm.get('release_time') || '').trim();
  if (releaseTime && !/^\d{1,2}:\d{2}$/.test(releaseTime)) {
    out.push(issue('release_time', 'warn', 'قالب release_time باید "20:00" باشد، گیومه‌دار.'));
  }

  const rawSale = fm.get('sale_price');
  if (rawSale !== undefined && rawSale !== null && String(rawSale).trim() !== '') {
    if (Number.isFinite(Number(fm.get('price'))) && Number(rawSale) >= Number(fm.get('price'))) {
      out.push(issue('sale_price', 'warn',
        'قیمت تخفیف‌خورده از price کمتر نیست. سیستم تخفیف را نادیده می‌گیرد و همان price را می‌گیرد.'));
    }
    const saleUntil = String(fm.get('sale_until') || '').trim();
    if (saleUntil && !DATE_OK.test(saleUntil)) {
      out.push(issue('sale_until', 'warn', 'قالب sale_until باید "1405-06-31" باشد، گیومه‌دار و دورقمی.'));
    }
    if (releaseDate) {
      out.push(issue('sale_price', 'warn',
        'تخفیف روی اثر پیش‌خرید تا روز انتشار نمی‌افتد؛ تا آن روز قیمت همان preorder_price است.'));
    }
  }

  if (!body.trim()) out.push(issue('body', 'block', 'متن خالی است.'));

  // Python-Markdown does not understand CriticMarkup and would print the
  // braces to the page, so nothing carrying marks may be published.
  const tracked = countChanges(body);
  if (tracked > 0) {
    out.push(issue('tracked', 'block',
      `${tracked} تغییر ردیابی‌شده هنوز رسیدگی نشده. سایت این علامت‌ها را نمی‌شناسد و خام چاپشان می‌کند — اول در پانل تغییرات بپذیر یا رد کن.`));
  }

  return out;
}

/* --------------------------------------------------------------------------
   Creator profiles
   build.py reads name, slug, image, roles and socials, and turns the body
   into the biography. Nothing else on the page comes from the file.
   -------------------------------------------------------------------------- */

function validateCreator(doc) {
  const fm = doc.frontmatter;
  const out = [];

  const name = String(fm.get('name') || '').trim();
  if (!name) {
    out.push(issue('name', 'block',
      'نام پدیدآورنده خالی است. build.py با همین نام، آثار را به این صفحه وصل می‌کند.'));
  }

  const slug = String(fm.get('slug') || '').trim();
  if (!slug) {
    out.push(issue('slug', 'block', 'اسلاگ خالی است؛ آدرس صفحه ساخته نمی‌شود.'));
  } else if (!SLUG_OK.test(slug)) {
    out.push(issue('slug', 'block',
      'اسلاگ فقط باید حروف کوچک انگلیسی، رقم و خط تیره داشته باشد.'));
  }

  const roles = fm.get('roles');
  if (!Array.isArray(roles) || roles.length === 0) {
    out.push(issue('roles', 'warn', 'هیچ نقشی انتخاب نشده؛ زیر نام چیزی نشان داده نمی‌شود.'));
  }

  const image = String(fm.get('image') || '').trim();
  if (!image) {
    out.push(issue('image', 'warn', 'عکس ندارد؛ صفحه بدون تصویر ساخته می‌شود.'));
  } else if (image.startsWith('/')) {
    // build.py looks for the image next to the .md file, then one folder up.
    // A path starting with a slash is resolved against neither.
    out.push(issue('image', 'warn',
      'مسیر عکس با / شروع شده. build.py عکس را کنار خود فایل یا یک پوشه بالاتر می‌گردد، پس بهتر است فقط نام فایل باشد. یک بار صفحه‌ی این پدیدآورنده را روی سایت ببین.'));
  }

  const socials = fm.getMap ? fm.getMap('socials') : {};
  for (const [key, value] of Object.entries(socials)) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (key === 'email') continue;
    if (!/^https?:\/\//i.test(text)) {
      const label = (SOCIAL_NETWORKS[key] && SOCIAL_NETWORKS[key].label) || key;
      out.push(issue('socials', 'warn', `نشانی ${label} با https:// شروع نمی‌شود.`));
    }
  }

  if (!doc.body.trim()) {
    out.push(issue('body', 'warn', 'زندگی‌نامه خالی است. متن این صفحه، همان چیزی است که اینجا می‌نویسی.'));
  }

  const tracked = countChanges(doc.body);
  if (tracked > 0) {
    out.push(issue('tracked', 'block',
      `${tracked} تغییر ردیابی‌شده هنوز رسیدگی نشده.`));
  }

  return out;
}

/** True when nothing would break on the site. */
export function isPublishable(doc) {
  return !validateDocument(doc).some((i) => i.severity === 'block');
}

/** Everything wrong with a document, including its name on disk. */
export function validateAll(doc, fileName) {
  return [...validateFileName(fileName), ...validateDocument(doc)];
}
